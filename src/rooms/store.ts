import type { BusEvent, MemberChange } from '../../contracts/events.ts';
import type {
  Agreement,
  AgentKind,
  ApprovalBehavior,
  Launch,
  Member,
  MessageKind,
  Presence,
  Question,
  QuestionItem,
  Room,
} from '../../contracts/room.ts';
import type { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import { SEAT_TOKEN_PREFIX } from '../../contracts/mcp.ts';
import {
  agreementSchema,
  approvalSchema,
  HUMAN_NAME,
  launchSchema,
  memberKindSchema,
  memberSchema,
  OBSERVER_ROLE,
  ORCHESTRATOR_ROLE,
  messageSchema,
  questionSchema,
  RESERVED_NAMES,
  roomSchema,
  roomSummarySchema,
  SYSTEM_NAME,
  TEXT_MAX_CHARS,
  UNASSIGNED_ROLE,
} from '../../contracts/room.ts';
import {
  APPROVAL_TEXT_MAX,
  APPROVAL_TTL_MS,
  DONE_AWAY_LEAVE_MS,
  INVITE_TTL_MS,
  LOOP_GUARD_BACKSTOP,
  LOOP_GUARD_LINES,
  LOOP_GUARD_PAUSE_MS,
  EDIT_WINDOW_MS,
  NOTE_HOLD_MS,
  LOOP_GUARD_WITHIN_MS,
  QUESTION_TTL_MS,
  READ_LIMIT,
  REVIEW_NUDGE_WINDOW_MS,
  SEARCH_LIMIT,
  SEAT_TOKEN_FREE_AFTER_MS,
  SPAWN_CAP_RING_EVERY_MS,
  SPAWN_RATE_WINDOW_MS,
  SPAWN_SEAT_CAP,
  STALE_AFTER_MS,
} from '../config.js';
import { parseStoredJson } from '../lib/json.js';
import { clientType } from '../mcp/constants.js';

import { agreementSql, involves, isLive, leftOut, proposalText, rejectText, settledText } from './agreements.js';
import { createEventBus } from './events.js';
import { answersFit, answerText, askText, expiryText, questionSql, storedAnswers } from './questions.js';
import { reviewNudges } from './reviews.js';
import {
  canAssignRole,
  isAgent,
  leavesDone,
  loopPair,
  missingMentions,
  nextPresence,
  parseMentions,
  spawnAllowed,
} from './rules.js';

export type TouchState = Exclude<Presence, 'idle'>;

export interface PresenceChange {
  from: Presence;
  name: string;
  room: string;
  to: Presence;
}

type Emit = (event: BusEvent) => void;

interface NewRoom {
  createdBy: string;
  name: string;
  topic?: string;
}
type Row = Record<string, unknown>;

interface Reclaim {
  existing: Member;
  holderDead: boolean;
  room: Room;
  seatKey: string | undefined;
}

const NAME_MAX = 40;

/** A fresh seat token for a join with no other seat key. Its prefix lets a lost one free the seat later. */
export const newSeatToken = () => `${SEAT_TOKEN_PREFIX}${randomUUID()}`;
// Only member posts count toward the summary schedule. Daemon lines and summaries do not.
const IS_POST = "kind IN ('chat', 'done')";

const withStanding = (row: Row) => ({ ...row, standing: row.standing === 1 });
const toRoom = (row: Row) => roomSchema.parse(withStanding(row));
const toMember = (row: Row) =>
  memberSchema.parse({
    ...row,
    client_label: row.client_name ? clientType(String(row.client_name)).label : null,
    done: row.done === 1,
    muted: row.muted === 1,
  });
const toMessage = (row: Row) =>
  messageSchema.parse({ ...row, from: row.from_name, mentions: parseStoredJson(String(row.mentions)) });

// Each word becomes a quoted prefix term, so FTS5 syntax in a query is just text.
const ftsQuery = (q: string) => Array.from(q.matchAll(/[\p{L}\p{N}_]+/gu), ([word]) => `"${word}"*`).join(' ');

const ANSWERED = { allow: 'allowed', deny: 'denied' } as const;
const clip = (text: string) => text.slice(0, APPROVAL_TEXT_MAX);

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });
// Only agents hold a seat key, never the human seat.
const AGENT_KIND = memberKindSchema.exclude(['human']);

const isReserved = (name: string) => (RESERVED_NAMES as readonly string[]).includes(name);

/**
 * The room store over one db handle. Every write runs in a transaction and its events reach
 * listeners only after the commit. Time comes from `now`, so tests drive the clock.
 */
export function createRoomStore({ db, now }: { db: DatabaseSync; now: () => Date }) {
  const bus = createEventBus({ db, now });
  const stamp = () => now().toISOString();
  // When this run marked seats reconnecting, so the sweep knows when to give up on them.
  let restartedAt: Date | undefined;

  const sql = {
    answerApproval: db.prepare(
      "UPDATE approvals SET state = ?, answered_at = ? WHERE id = ? AND state = 'pending' RETURNING *",
    ),
    expireAllApprovals: db.prepare(
      "UPDATE approvals SET state = 'expired', answered_at = ? WHERE state = 'pending' RETURNING *",
    ),
    expireOldApprovals: db.prepare(
      "UPDATE approvals SET state = 'expired', answered_at = ? WHERE state = 'pending' AND created_at <= ? RETURNING *",
    ),
    expireSessionApprovals: db.prepare(
      "UPDATE approvals SET state = 'expired', answered_at = ? WHERE state = 'pending' AND session = ? RETURNING *",
    ),
    insertApproval: db.prepare(
      "INSERT INTO approvals (id, room_id, member, session, request_id, tool, description, input_preview, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?) RETURNING *",
    ),
    pendingApprovals: db.prepare(
      "SELECT * FROM approvals WHERE room_id = ? AND state = 'pending' ORDER BY created_at, id",
    ),
    allMembers: db.prepare('SELECT * FROM members WHERE room_id = ? ORDER BY name'),
    closeRoom: db.prepare('UPDATE rooms SET closed_at = ? WHERE id = ?'),
    countPosts: db.prepare(`SELECT count(*) AS n FROM messages WHERE room_id = ? AND ${IS_POST}`),
    countPostsUpTo: db.prepare(`SELECT count(*) AS n FROM messages WHERE room_id = ? AND ${IS_POST} AND id <= ?`),
    insertMember: db.prepare(
      'INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence, cursor, client_name, client_version, role, seat_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    insertInvite: db.prepare(
      "INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence, cursor, role, role_instructions, role_set_by, seat_key, launch) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?, ?, ?, ?, ?)",
    ),
    insertMessage: db.prepare(
      'INSERT INTO messages (room_id, from_name, kind, text, mentions, created_at, from_kind, from_client_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    ),
    insertSummary: db.prepare(
      "INSERT INTO messages (room_id, from_name, kind, text, created_at, covers_id) VALUES (?, ?, 'summary', ?, ?, ?) RETURNING *",
    ),
    insertRoom: db.prepare(
      'INSERT INTO rooms (id, name, topic, created_at, created_by, standing) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    spawnedSeats: db.prepare(
      'SELECT count(*) AS n FROM members WHERE room_id = ? AND left_at IS NULL AND launch IS NOT NULL',
    ),
    expiredInvites: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE presence = 'invited' AND joined_at <= ? ORDER BY rooms.name, members.name",
    ),
    latest: db.prepare('SELECT * FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id'),
    latestSummary: db.prepare("SELECT * FROM messages WHERE room_id = ? AND kind = 'summary' ORDER BY id DESC LIMIT 1"),
    lastPosts: db.prepare(
      `SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND ${IS_POST} ORDER BY id DESC LIMIT ?) ORDER BY id`,
    ),
    latestId: db.prepare('SELECT max(id) AS id FROM messages WHERE room_id = ?'),
    leave: db.prepare(
      "UPDATE members SET left_at = ?, presence = 'left', status = NULL, status_at = NULL WHERE room_id = ? AND name = ?",
    ),
    liveMembers: db.prepare('SELECT * FROM members WHERE room_id = ? AND left_at IS NULL ORDER BY name'),
    member: db.prepare('SELECT * FROM members WHERE room_id = ? AND name = ?'),
    messagesAfter: db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? ORDER BY id LIMIT ?'),
    messagesBefore: db.prepare(
      'SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    ),
    paused: db.prepare(
      'SELECT name, paused_with, paused_at FROM members WHERE room_id = ? AND paused_with IS NOT NULL',
    ),
    pause: db.prepare('UPDATE members SET paused_with = ?, paused_at = ? WHERE room_id = ? AND name = ?'),
    duePauses: db.prepare(
      'SELECT members.*, rooms.name AS room_name FROM members JOIN rooms ON rooms.id = members.room_id WHERE paused_with IS NOT NULL AND (paused_at IS NULL OR paused_at <= ?) ORDER BY rooms.name, members.name',
    ),
    endPause: db.prepare('UPDATE members SET paused_with = NULL WHERE room_id = ? AND name = ?'),
    lastPostBy: db.prepare(
      `SELECT * FROM messages WHERE room_id = ? AND from_name = ? AND ${IS_POST} ORDER BY id DESC LIMIT 1`,
    ),
    rewritePost: db.prepare(
      'UPDATE messages SET text = ?, mentions = ?, edited_at = ?, removed_at = ? WHERE id = ? RETURNING *',
    ),
    lastUnreadFrom: db.prepare(
      `SELECT * FROM messages WHERE room_id = ? AND from_name = ? AND id > ? AND ${IS_POST} ORDER BY id DESC LIMIT 1`,
    ),
    pausedAt: db.prepare('SELECT paused_at FROM members WHERE room_id = ? AND name = ?'),
    unpause: db.prepare('UPDATE members SET paused_with = NULL, paused_at = NULL WHERE room_id = ? AND name IN (?, ?)'),
    unpauseAll: db.prepare('UPDATE members SET paused_with = NULL, paused_at = NULL WHERE room_id = ?'),
    postsAfter: db.prepare(`SELECT * FROM messages WHERE room_id = ? AND ${IS_POST} AND id > ? ORDER BY id`),
    holdNote: db.prepare(
      'INSERT OR IGNORE INTO held_notes (room_id, name, message_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    heldNotes: db.prepare(
      'SELECT n.message_id, m.from_name FROM held_notes n JOIN messages m ON m.id = n.message_id WHERE n.room_id = ? AND n.name = ? AND n.created_at >= ? ORDER BY n.message_id',
    ),
    dropNotes: db.prepare('DELETE FROM held_notes WHERE room_id = ? AND name = ?'),
    dropOldNotes: db.prepare('DELETE FROM held_notes WHERE created_at < ?'),
    noteMessages: db.prepare(
      'SELECT m.* FROM held_notes n JOIN messages m ON m.id = n.message_id WHERE n.room_id = ? AND n.name = ? AND n.created_at >= ? ORDER BY m.id',
    ),
    moveCursor: db.prepare('UPDATE members SET cursor = ? WHERE room_id = ? AND name = ?'),
    rejoin: db.prepare(
      "UPDATE members SET kind = ?, client_name = ?, client_version = ?, seat_key = ?, left_at = NULL, last_seen_at = ?, presence = 'active', done = done * ? WHERE room_id = ? AND name = ?",
    ),
    reopen: db.prepare('UPDATE rooms SET closed_at = NULL WHERE id = ?'),
    linesSince: db.prepare('SELECT * FROM messages WHERE room_id = ? AND created_at > ? ORDER BY id'),
    nudgeRooms: db.prepare('SELECT * FROM rooms WHERE closed_at IS NULL AND review_nudges = 1 ORDER BY name'),
    reviewNudges: db.prepare('SELECT review_nudges FROM rooms WHERE id = ?'),
    setReviewNudges: db.prepare('UPDATE rooms SET review_nudges = ? WHERE id = ?'),
    room: db.prepare('SELECT * FROM rooms WHERE name = ?'),
    roomById: db.prepare('SELECT * FROM rooms WHERE id = ?'),
    rooms: db.prepare(
      `SELECT rooms.*, (SELECT count(*) FROM messages WHERE room_id = rooms.id AND ${IS_POST}) AS message_count, (SELECT min(id) FROM messages WHERE room_id = rooms.id) AS first_message_id FROM rooms ORDER BY name`,
    ),
    search: db.prepare(
      'SELECT messages.*, rooms.name AS room FROM messages_fts JOIN messages ON messages.id = messages_fts.rowid JOIN rooms ON rooms.id = messages.room_id WHERE messages_fts MATCH ? AND (? IS NULL OR rooms.id = ?) ORDER BY messages.id DESC LIMIT ?',
    ),
    removeMember: db.prepare('DELETE FROM members WHERE room_id = ? AND name = ?'),
    seatKey: db.prepare('SELECT seat_key FROM members WHERE room_id = ? AND name = ?'),
    seats: db.prepare(
      'SELECT rooms.name AS room, members.name, members.kind FROM members JOIN rooms ON rooms.id = members.room_id WHERE seat_key = ? AND left_at IS NULL ORDER BY rooms.name, members.name',
    ),
    seen: db.prepare('UPDATE members SET presence = ?, last_seen_at = ? WHERE room_id = ? AND name = ?'),
    setRole: db.prepare(
      'UPDATE members SET role = ?, role_instructions = ?, role_set_by = ? WHERE room_id = ? AND name = ?',
    ),
    setMuted: db.prepare('UPDATE members SET muted = ? WHERE room_id = ? AND name = ?'),
    setStatus: db.prepare('UPDATE members SET status = ?, status_at = ? WHERE room_id = ? AND name = ?'),
    setDone: db.prepare('UPDATE members SET done = ? WHERE room_id = ? AND name = ?'),
    setTopic: db.prepare('UPDATE rooms SET topic = ? WHERE id = ?'),
    setPresence: db.prepare('UPDATE members SET presence = ? WHERE room_id = ? AND name = ?'),
    stale: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE kind != 'human' AND left_at <= ? ORDER BY rooms.name, members.name",
    ),
    doneAway: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE left_at IS NULL AND done = 1 AND presence = 'away' ORDER BY rooms.name, members.name",
    ),
    sweepable: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE left_at IS NULL AND kind != 'human' AND presence NOT IN ('away', 'invited') ORDER BY rooms.name, members.name",
    ),
    wakeable: db.prepare(
      "SELECT rooms.name AS room, members.name, members.kind, members.seat_key FROM members JOIN rooms ON rooms.id = members.room_id WHERE left_at IS NULL AND presence IN ('reconnecting', 'away') ORDER BY rooms.name, members.name",
    ),
    unseen: db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? AND from_name != ? ORDER BY id LIMIT ?'),
  };

  const questionsSql = questionSql(db);
  const agreementsSql = agreementSql(db);

  function transaction<T>(work: (emit: Emit) => T) {
    const pending: BusEvent[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work(event => pending.push(event));
      db.exec('COMMIT');
      pending.forEach(event => bus.emit(event));
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const findRoom = (name: string) => {
    const row = sql.room.get(name);
    return row ? toRoom(row) : undefined;
  };
  const roomById = (id: string) => toRoom(sql.roomById.get(id)!);
  // In memory, per room id: kicked and failed spawns leave no row, but still count toward the rate.
  const spawnLog = new Map<string, number[]>();
  const capRungAt = new Map<string, number>();
  const toApproval = (row: Row) => approvalSchema.parse({ ...row, room: roomById(String(row.room_id)).name });
  // Puts each changed row on the feed and lists each ask once, however many rooms it sits in.
  const settled = (rows: Row[], emit: Emit) => {
    const asks = new Map<string, { requestId: string; session: string }>();
    rows.forEach(row => {
      const approval = toApproval(row);
      emit({ approval, room: approval.room, type: 'approval' });
      asks.set(approval.id, { requestId: String(row.request_id), session: String(row.session) });
    });
    return [...asks.values()];
  };
  const toQuestion = (row: Row) =>
    questionSchema.parse({
      ...row,
      answers: row.answers === null ? null : parseStoredJson(String(row.answers)),
      questions: parseStoredJson(String(row.items)),
      room: roomById(String(row.room_id)).name,
    });
  const questionChanged = (question: Question, emit: Emit) => {
    emit({ question, room: question.room, type: 'question' });
    return question;
  };
  const toAgreement = (row: Row) =>
    agreementSchema.parse({
      ...row,
      confirmed: parseStoredJson(String(row.confirmed)),
      room: roomById(String(row.room_id)).name,
      with: parseStoredJson(String(row.with_names)),
    });
  const agreementChanged = (agreement: Agreement, emit: Emit) => {
    emit({ agreement, room: agreement.room, type: 'agreement' });
    return agreement;
  };
  const findAgreement = (room: Room, id: number) => {
    const row = agreementsSql.get.get(id, room.id);
    return row ? toAgreement(row) : undefined;
  };
  const findMember = (room: Room, name: string) => {
    const row = sql.member.get(room.id, name);
    return row ? toMember(row) : undefined;
  };
  const countPosts = (room: Room) => Number(sql.countPosts.get(room.id)?.n);
  const latestSummaryRow = (room: Room) => sql.latestSummary.get(room.id);
  // A new member starts where the latest summary stands, so its first read is that summary.
  const noteCutoff = () => new Date(now().getTime() - NOTE_HOLD_MS).toISOString();
  const startCursor = (room: Room) => Number(latestSummaryRow(room)?.covers_id ?? 0);

  // The sender's kind and label go on the post, so the transcript can show them after the sender leaves.
  function post(room: Room, from: Member | string, kind: MessageKind, text: string, mentions: string[], emit: Emit) {
    const [name, fromKind, label] =
      typeof from === 'string' ? [from, null, null] : [from.name, from.kind, from.client_label];
    const row = sql.insertMessage.get(room.id, name, kind, text, JSON.stringify(mentions), stamp(), fromKind, label);
    const message = toMessage(row!);
    emit({ message, room: room.name, type: 'message' });
    return message;
  }
  const systemLine = (room: Room, text: string, emit: Emit) => post(room, SYSTEM_NAME, 'system', text, [], emit);

  function setPresence(room: Room, member: Member, to: Presence, emit: Emit, seen: boolean) {
    if (seen) sql.seen.run(to, stamp(), room.id, member.name);
    if (member.presence === to) return;
    if (!seen) sql.setPresence.run(to, room.id, member.name);
    emit({ from: member.presence, name: member.name, room: room.name, to, type: 'presence' });
    if (to === 'away') systemLine(room, `${member.name} is away`, emit);
  }

  function addHuman(room: Room, emit: Emit) {
    const existing = findMember(room, HUMAN_NAME);
    if (existing) return existing;
    sql.insertMember.run(room.id, HUMAN_NAME, 'human', stamp(), stamp(), 'idle', 0, null, null, UNASSIGNED_ROLE, null);
    const member = findMember(room, HUMAN_NAME)!;
    emit({ change: 'joined', member, room: room.name, type: 'member' });
    return member;
  }

  // Only a room the human makes is standing.
  function makeRoom({ createdBy, name, topic }: NewRoom, emit: Emit) {
    const standing = createdBy === HUMAN_NAME;
    sql.insertRoom.run(randomUUID(), name, topic ?? null, stamp(), createdBy, standing ? 1 : 0);
    const room = findRoom(name)!;
    emit({ change: 'created', room, type: 'room' });
    addHuman(room, emit);
    return room;
  }

  function close(room: Room, text: string, emit: Emit) {
    sql.closeRoom.run(stamp(), room.id);
    systemLine(room, text, emit);
    emit({ change: 'closed', room: roomById(room.id), type: 'room' });
  }

  // A room an agent made closes once every agent still in it is done. Observers never hold it open.
  function closeIfAllDone(room: Room, emit: Emit) {
    if (room.standing || room.closed_at !== null) return;
    const agents = sql.liveMembers.all(room.id).map(toMember).filter(isAgent);
    if (agents.length && agents.every(member => member.done)) close(room, 'all done, room closed', emit);
  }

  function reopen(room: Room, emit: Emit) {
    sql.reopen.run(room.id);
    const reopened = roomById(room.id);
    systemLine(reopened, `#${room.name} reopened`, emit);
    emit({ change: 'reopened', room: reopened, type: 'room' });
    return reopened;
  }

  function suggestName(room: Room, name: string) {
    for (let n = 2; ; n += 1) {
      const suffix = `-${n}`;
      const candidate = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
      if (!findMember(room, candidate)) return candidate;
    }
  }

  // A keyed seat goes back only to its own key. A keyless one has no owner to check, so an away or dead holder lets go.
  // A token seat turns keyless after a long time away with no live session, so a lost token does not lock the name.
  function reclaims({ existing, holderDead, room, seatKey }: Reclaim) {
    const key = sql.seatKey.get(room.id, existing.name)?.seat_key;
    if (typeof key !== 'string') return existing.presence === 'away' || holderDead;
    if (key === seatKey) return true;
    const awayMs = now().getTime() - Date.parse(existing.last_seen_at);
    return (
      key.startsWith(SEAT_TOKEN_PREFIX) &&
      holderDead &&
      existing.presence === 'away' &&
      awayMs >= SEAT_TOKEN_FREE_AFTER_MS
    );
  }

  function leave(room: Room, name: string, line: string, emit: Emit) {
    sql.leave.run(stamp(), room.id, name);
    emit({ change: 'left', member: findMember(room, name)!, room: room.name, type: 'member' });
    systemLine(room, line, emit);
  }

  function drop(room: Room, member: Member, emit: Emit) {
    sql.removeMember.run(room.id, member.name);
    emit({ change: 'removed', member, room: room.name, type: 'member' });
  }

  function kick(room: Room, name: string, emit: Emit) {
    const member = findMember(room, name);
    if (!member) return { ok: false, reason: 'no_member' } as const;
    if (member.kind === 'human') return { ok: false, reason: 'human' } as const;
    drop(room, member, emit);
    return { member, ok: true } as const;
  }

  const pauses = (room: Room) =>
    sql.paused
      .all(room.id)
      .map(row => ({ at: String(row.paused_at ?? ''), name: String(row.name), with: String(row.paused_with) }));

  const pausedIn = (room: Room) => {
    const cutoff = new Date(now().getTime() - LOOP_GUARD_PAUSE_MS).toISOString();
    return Object.fromEntries(
      pauses(room)
        .filter(pause => pause.at > cutoff)
        .map(pause => [pause.name, pause.with]),
    );
  };

  // Two agents trading lines alone pause each other once, and the human hears about it in the same write.
  // A run counts only lines after the poster's last pause began, so an ended pause does not fire again at once.
  function guardLoop(room: Room, from: string, emit: Emit) {
    const since = String(sql.pausedAt.get(room.id, from)?.paused_at ?? '');
    const posts = sql.lastPosts
      .all(room.id, LOOP_GUARD_BACKSTOP)
      .map(toMessage)
      .filter(message => message.created_at > since);
    const found = loopPair({
      backstop: LOOP_GUARD_BACKSTOP,
      lines: LOOP_GUARD_LINES,
      posts,
      withinMs: LOOP_GUARD_WITHIN_MS,
    });
    if (!found) return;
    const [a, b] = found.pair;
    const paused = pausedIn(room);
    if (paused[a] === b && paused[b] === a) return;
    sql.pause.run(b, stamp(), room.id, a);
    sql.pause.run(a, stamp(), room.id, b);
    const pace = found.fast ? ` in ${LOOP_GUARD_WITHIN_MS / 60_000} minutes` : '';
    const text = `@${HUMAN_NAME} ${a} and ${b} have traded ${found.lines} lines${pace} with no one else, their doorbells are paused for ${LOOP_GUARD_PAUSE_MS / 60_000} minutes or until one of them posts to @${HUMAN_NAME}`;
    post(room, SYSTEM_NAME, 'system', text, [HUMAN_NAME], emit);
  }

  // A paused agent explaining itself to the human lifts its pair's pause.
  function liftPause(room: Room, from: string) {
    const partner = pausedIn(room)[from];
    if (partner) sql.unpause.run(room.id, from, partner);
  }

  // A member's line with what follows it: done, presence, pauses, the loop guard, the all done close.
  function speak(
    { done, member, room, text }: { done: boolean; member: Member; room: Room; text: string },
    emit: Emit,
  ) {
    const human = member.kind === 'human';
    const names = sql.liveMembers.all(room.id).map(row => String(row.name));
    const kind = done && !human ? 'done' : 'chat';
    const message = post(room, member, kind, text, parseMentions({ names, text }), emit);
    sql.setDone.run(kind === 'done' ? 1 : 0, room.id, member.name);
    setPresence(room, member, 'active', emit, true);
    if (human) sql.unpauseAll.run(room.id);
    else {
      if (message.mentions.includes(HUMAN_NAME)) liftPause(room, member.name);
      guardLoop(room, member.name, emit);
    }
    if (kind === 'done') closeIfAllDone(room, emit);
    const missing = missingMentions({ names, text });
    for (const name of missing) sql.holdNote.run(room.id, name, message.id, stamp());
    return { message, missing };
  }

  // Finds the room and a member still in it, the gate every member call goes through.
  function seat(roomName: string, name: string) {
    const room = findRoom(roomName);
    if (!room) return { ok: false, reason: 'no_room' } as const;
    const member = findMember(room, name);
    if (!member || member.left_at !== null) return { ok: false, reason: 'not_member' } as const;
    return { member, ok: true, room } as const;
  }

  // Rewrites the member's last post inside the edit window and tells the feed. Nobody is rung for it.
  function rewriteLastPost(
    { as, room: roomName, text }: { as: string; room: string; text: string | null },
    emit: Emit,
  ) {
    if (text !== null && text.length > TEXT_MAX_CHARS) {
      return { length: text.length, ok: false, reason: 'too_long' } as const;
    }
    const found = seat(roomName, as);
    if (!found.ok) return found;
    const { member, room } = found;
    if (member.muted) return { ok: false, reason: 'muted' } as const;
    if (room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
    const last = sql.lastPostBy.get(room.id, as);
    if (!last) return { ok: false, reason: 'no_post' } as const;
    if (last.removed_at !== null) return { ok: false, reason: 'removed' } as const;
    if (now().getTime() - Date.parse(String(last.created_at)) > EDIT_WINDOW_MS) {
      return { ok: false, reason: 'too_old' } as const;
    }
    const names = sql.liveMembers.all(room.id).map(row => String(row.name));
    const at = stamp();
    const row = sql.rewritePost.get(
      text ?? '',
      JSON.stringify(text === null ? [] : parseMentions({ names, text })),
      at,
      text === null ? at : null,
      Number(last.id),
    );
    const message = toMessage(row!);
    emit({ message, room: room.name, type: 'message_edit' });
    const before = parseStoredJson(String(last.mentions)) as string[];
    return { added: message.mentions.filter(name => !before.includes(name)), message, ok: true } as const;
  }

  // The gate for agreement calls: a seat that may speak, in an open room.
  function speaker(roomName: string, as: string) {
    const found = seat(roomName, as);
    if (!found.ok) return found;
    if (found.member.muted) return { ok: false, reason: 'muted' } as const;
    if (found.room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
    return found;
  }

  // An agreement in the room that is still open or settled, for a reject or a replace.
  function liveAgreement(room: Room, id: number) {
    const agreement = findAgreement(room, id);
    if (!agreement) return { ok: false, reason: 'no_agreement' } as const;
    if (!isLive(agreement)) return { ok: false, reason: 'not_open' } as const;
    return { agreement, ok: true } as const;
  }

  return {
    events: { bounds: bus.bounds, on: bus.on, since: bus.since },

    /** Closes an open room by hand with a system line. */
    closeRoom(roomName: string) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        if (room.closed_at !== null) return { ok: false, reason: 'closed' } as const;
        close(room, `#${room.name} closed by the human`, emit);
        return { ok: true, room: roomById(room.id) } as const;
      });
    },

    /** Makes a room with the human seat. A room the human makes is standing: only the human closes it. */
    createRoom({ created_by: createdBy, name, topic }: { created_by: string; name: string; topic?: string }) {
      return transaction(emit => {
        if (findRoom(name)) return { ok: false, reason: 'exists' } as const;
        return { ok: true, room: makeRoom({ createdBy, name, topic }, emit) } as const;
      });
    },

    /** Stores a summary from messhall that covers posts up to `coversId`. It never counts as a post. */
    addSummary({ coversId, room: roomName, text }: { coversId: number; room: string; text: string }) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        const message = toMessage(sql.insertSummary.get(room.id, SYSTEM_NAME, text, stamp(), coversId)!);
        emit({ message, room: room.name, type: 'message' });
        return { message, ok: true } as const;
      });
    },

    /** Adds the human seat to a room that lacks it. Rooms made by `joinRoom` already have it. */
    ensureHuman(roomName: string) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        return { member: addHuman(room, emit), ok: true } as const;
      });
    },

    /**
     * Joins `as` to the room, making the room on first join. A seat still held goes back, with its cursor
     * and role ("reconnected"), only to the same `seatKey`. A keyless seat goes to any caller once it is
     * away or its session is dead (`holderDead`). Anyone else gets `name_taken` with a free name to try.
     * An `invite` token proves the seat in place of `seatKey`, which becomes the key from then on.
     * A closed standing room waits for the human to reopen it. A `reattach` keeps the done mark, a join clears it.
     * `observe` makes the seat an observer, new or not.
     * `topic` counts only on the join that makes the room.
     */
    joinRoom({
      as,
      client,
      holderDead = false,
      invite,
      kind,
      observe = false,
      reattach = false,
      room: roomName,
      seatKey,
      topic,
    }: {
      as: string;
      client?: { name: string; version: string };
      holderDead?: boolean;
      invite?: string;
      kind: AgentKind;
      observe?: boolean;
      reattach?: boolean;
      room: string;
      seatKey?: string;
      topic?: string;
    }) {
      if (isReserved(as)) return { ok: false, reason: 'name_reserved' } as const;
      return transaction(emit => {
        const found = findRoom(roomName);
        if (invite && !(found && findMember(found, as))) return { ok: false, reason: 'no_invite' } as const;
        const room = found ?? makeRoom({ createdBy: as, name: roomName, topic }, emit);
        if (room.standing && room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
        const existing = findMember(room, as);
        const proof = invite ?? seatKey;
        if (existing && existing.left_at === null && !reclaims({ existing, holderDead, room, seatKey: proof })) {
          return { ok: false, reason: 'name_taken', suggestion: suggestName(room, as) } as const;
        }
        const change: MemberChange =
          existing?.left_at === null && existing.presence !== 'invited' ? 'reconnected' : 'joined';
        const cursor = startCursor(room);
        const held = sql.heldNotes.all(room.id, as, noteCutoff());
        const [name, version] = [client?.name ?? null, client?.version ?? null];
        const role = observe ? OBSERVER_ROLE : UNASSIGNED_ROLE;
        const seatKeyOrNull = seatKey ?? invite ?? null;
        if (existing) sql.rejoin.run(kind, name, version, seatKeyOrNull, stamp(), reattach ? 1 : 0, room.id, as);
        if (existing && observe) sql.setRole.run(OBSERVER_ROLE, null, as, room.id, as);
        if (!existing) {
          const at = stamp();
          sql.insertMember.run(room.id, as, kind, at, at, 'active', cursor, name, version, role, seatKeyOrNull);
        }
        const notes = { count: held.length, from: Array.from(new Set(held.map(row => String(row.from_name)))) };
        const member = findMember(room, as)!;
        emit({ change, member, room: room.name, type: 'member' });
        systemLine(room, `${as} ${change}`, emit);
        return { change, member, notes, ok: true, room } as const;
      });
    },

    /**
     * Makes a seat ahead of its agent: presence invited, with its role, instructions and how to launch it.
     * Only the human or an unmuted orchestrator may, and only the human makes an orchestrator.
     * An orchestrator is held to the spawn cap and rate here, in one transaction, so two calls at once cannot pass it.
     * The rate log lives in memory, so a daemon restart forgets it.
     * Returns the fresh seat key, the one thing that later sits in the seat.
     */
    invite({
      by,
      instructions,
      launch,
      name,
      role,
      room: roomName,
    }: {
      by: string;
      instructions?: string;
      launch: Launch;
      name: string;
      role: string;
      room: string;
    }) {
      if (isReserved(name)) return { ok: false, reason: 'name_reserved' } as const;
      return transaction(emit => {
        const found = seat(roomName, by);
        if (!found.ok) return found;
        const { member: inviter, room } = found;
        // An orchestrator that could make orchestrators could hand its powers to any agent.
        const madeOrchestrator = role === ORCHESTRATOR_ROLE && inviter.kind !== 'human';
        if (!canAssignRole({ by: inviter }) || madeOrchestrator) return { ok: false, reason: 'not_allowed' } as const;
        if (inviter.muted) return { ok: false, reason: 'muted' } as const;
        if (room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
        const at = now().getTime();
        const spawnedAt = (spawnLog.get(room.id) ?? []).filter(time => time > at - SPAWN_RATE_WINDOW_MS);
        const seats = Number(sql.spawnedSeats.get(room.id)?.n);
        const allowed = inviter.kind === 'human' ? 'ok' : spawnAllowed({ now: now(), seats, spawnedAt });
        if (allowed === 'seat_cap') {
          if (at - (capRungAt.get(room.id) ?? -Infinity) >= SPAWN_CAP_RING_EVERY_MS) {
            capRungAt.set(room.id, at);
            const text = `@${HUMAN_NAME} ${by} asked for ${name} (${role}) but #${room.name} is at its cap of ${SPAWN_SEAT_CAP} spawned seats. start it yourself, or kick a seat first`;
            post(room, SYSTEM_NAME, 'system', text, [HUMAN_NAME], emit);
          }
          return { cap: SPAWN_SEAT_CAP, ok: false, reason: allowed } as const;
        }
        if (allowed === 'spawn_rate') return { ok: false, reason: allowed } as const;
        if (findMember(room, name)) {
          return { ok: false, reason: 'name_taken', suggestion: suggestName(room, name) } as const;
        }
        const seatKey = randomUUID();
        const joinedAt = stamp();
        const spec = JSON.stringify(launch);
        spawnLog.set(room.id, [...spawnedAt, at]);
        sql.insertInvite.run(
          room.id,
          name,
          launch.agent,
          joinedAt,
          joinedAt,
          startCursor(room),
          role,
          instructions ?? null,
          by,
          seatKey,
          spec,
        );
        const member = findMember(room, name)!;
        emit({ change: 'invited', member, room: room.name, type: 'member' });
        systemLine(room, `${by} started ${name} (${role}) in ${launch.cwd}`, emit);
        return { member, ok: true, seatKey } as const;
      });
    },

    /** How to start a member's agent, from its invite. Undefined for a member that joined on its own, or none. */
    launchOf({ name, room: roomName }: { name: string; room: string }) {
      const room = findRoom(roomName);
      const launch = room && sql.member.get(room.id, name)?.launch;
      return typeof launch === 'string' ? launchSchema.parse(parseStoredJson(launch)) : undefined;
    },

    /** The key a member's seat goes back to, so a restarted agent sits in the same seat. */
    seatKeyOf({ name, room: roomName }: { name: string; room: string }) {
      const room = findRoom(roomName);
      const key = room && sql.seatKey.get(room.id, name)?.seat_key;
      return typeof key === 'string' ? key : undefined;
    },

    /** Posts a daemon line from outside the store, like a seat restart. `ringHuman` mentions the human in it. */
    systemNote({ ringHuman = false, room: roomName, text }: { ringHuman?: boolean; room: string; text: string }) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        post(room, SYSTEM_NAME, 'system', text, ringHuman ? [HUMAN_NAME] : [], emit);
        return { ok: true } as const;
      });
    },

    /** Drops invites whose agent made no call in 10 minutes, with a line each. */
    expireInvites() {
      return transaction(emit => {
        const cutoff = new Date(now().getTime() - INVITE_TTL_MS).toISOString();
        return sql.expiredInvites.all(cutoff).map(row => {
          const member = toMember(row);
          const room = roomById(member.room_id);
          drop(room, member, emit);
          systemLine(room, `${member.name} never came, invite dropped`, emit);
          closeIfAllDone(roomById(room.id), emit);
          return { name: member.name, room: room.name };
        });
      });
    },

    /** Sets a member's role, even one who left, since a role outlives a leave.
     * Only the human seat or an orchestrator in the room may, so `by` is checked first. */
    assignRole({
      by,
      instructions,
      member: name,
      role,
      room: roomName,
    }: {
      by: string;
      instructions?: string;
      member: string;
      role: string;
      room: string;
    }) {
      return transaction(emit => {
        const found = seat(roomName, by);
        if (!found.ok) return found;
        if (!canAssignRole({ by: found.member })) return { ok: false, reason: 'not_allowed' } as const;
        const target = findMember(found.room, name);
        if (!target) return { ok: false, reason: 'no_member' } as const;
        sql.setRole.run(role, instructions ?? null, by, found.room.id, name);
        const member = findMember(found.room, name)!;
        emit({ change: 'role', member, room: found.room.name, type: 'member' });
        return { member, ok: true } as const;
      });
    },

    /** Mutes or unmutes a member with a system line. A muted member reads but cannot post. Only the human seat or
     * an unmuted orchestrator may, so a muted one cannot lift its own mute. Never on the human. Setting the state it
     * already has writes nothing. */
    muteMember({
      by,
      member: name,
      muted,
      room: roomName,
    }: {
      by: string;
      member: string;
      muted: boolean;
      room: string;
    }) {
      return transaction(emit => {
        const found = seat(roomName, by);
        if (!found.ok) return found;
        if (!canAssignRole({ by: found.member })) return { ok: false, reason: 'not_allowed' } as const;
        if (found.member.muted) return { ok: false, reason: 'muted' } as const;
        const target = findMember(found.room, name);
        if (!target) return { ok: false, reason: 'no_member' } as const;
        if (target.kind === 'human') return { ok: false, reason: 'human' } as const;
        if (target.muted === muted) return { member: target, ok: true } as const;
        sql.setMuted.run(muted ? 1 : 0, found.room.id, name);
        const member = findMember(found.room, name)!;
        emit({ change: muted ? 'muted' : 'unmuted', member, room: found.room.name, type: 'member' });
        systemLine(found.room, `${name} ${muted ? 'muted' : 'unmuted'} by ${by}`, emit);
        return { member, ok: true } as const;
      });
    },

    /** Sets the topic with a system line. Only the room's maker, the human seat or an unmuted orchestrator may.
     * Setting the topic it already has writes nothing. */
    setTopic({ by, room: roomName, topic }: { by: string; room: string; topic: string }) {
      return transaction(emit => {
        const found = seat(roomName, by);
        if (!found.ok) return found;
        const { member, room } = found;
        const allowed = canAssignRole({ by: member }) || room.created_by === by;
        if (!allowed) return { ok: false, reason: 'not_allowed' } as const;
        if (member.muted) return { ok: false, reason: 'muted' } as const;
        if (room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
        if (room.topic === topic) return { ok: true, room } as const;
        sql.setTopic.run(topic, room.id);
        const updated = roomById(room.id);
        emit({ change: 'topic', room: updated, type: 'room' });
        systemLine(updated, `topic set by ${by}: ${topic}`, emit);
        return { ok: true, room: updated } as const;
      });
    },

    /** Sets the member's own status, or clears it when empty. It writes no line, so it never rings anyone. */
    setStatus({ as, room: roomName, status }: { as: string; room: string; status: string }) {
      return transaction(emit => {
        const found = seat(roomName, as);
        if (!found.ok) return found;
        if (found.member.muted) return { ok: false, reason: 'muted' } as const;
        sql.setStatus.run(status || null, status ? stamp() : null, found.room.id, as);
        const member = findMember(found.room, as)!;
        emit({ change: 'status', member, room: found.room.name, type: 'member' });
        return { member, ok: true } as const;
      });
    },

    /** A member's role with its instructions and who set them, or undefined when there is no such member. */
    roleOf({ name, room: roomName }: { name: string; room: string }) {
      const room = findRoom(roomName);
      const row = room && sql.member.get(room.id, name);
      if (!row) return;
      const text = (value: unknown) => (value === null ? null : String(value));
      return { by: text(row.role_set_by), instructions: text(row.role_instructions), role: String(row.role) };
    },

    /** Leaves the room with a system line. The cursor stays for a later join. */
    leaveRoom({ as, note, room: roomName }: { as: string; note?: string; room: string }) {
      return transaction(emit => {
        const found = seat(roomName, as);
        if (!found.ok) return found;
        leave(found.room, as, note ? `${as} left: ${note}` : `${as} left`, emit);
        return { ok: true } as const;
      });
    },

    /** Makes every seat that said done and has been away an hour leave, with a line each. */
    leaveDoneAway() {
      return transaction(emit => {
        const at = now();
        return sql.doneAway.all().flatMap(row => {
          const member = toMember(row);
          if (!leavesDone({ member, now: at })) return [];
          const room = roomById(member.room_id);
          leave(
            room,
            member.name,
            `${member.name} left, done and away for ${DONE_AWAY_LEAVE_MS / 60_000} minutes`,
            emit,
          );
          return [{ name: member.name, room: room.name }];
        });
      });
    },

    /** Members still in the room, by name, and with `left` those who left too. Empty when the room does not exist. */
    listMembers(roomName: string, { left = false }: { left?: boolean } = {}) {
      const room = findRoom(roomName);
      if (!room) return [];
      return (left ? sql.allMembers : sql.liveMembers).all(room.id).map(toMember);
    },

    /**
     * A page of a room's messages, system lines too, oldest first: the latest `limit`, the `limit` after `after`,
     * or the `limit` just below `before`. Reads only, so no cursor or presence moves.
     */
    listMessages({
      after,
      before,
      limit,
      room: roomName,
    }: {
      after?: number;
      before?: number;
      limit: number;
      room: string;
    }) {
      const room = findRoom(roomName);
      if (!room) return { ok: false, reason: 'no_room' } as const;
      const rows =
        after !== undefined
          ? sql.messagesAfter.all(room.id, after, limit)
          : before !== undefined
            ? sql.messagesBefore.all(room.id, before, limit)
            : sql.latest.all(room.id, limit);
      return { messages: rows.map(toMessage), ok: true } as const;
    },

    /** The room's latest summary, or undefined when it has none. */
    latestSummary(roomName: string) {
      const room = findRoom(roomName);
      const row = room && latestSummaryRow(room);
      return row ? toMessage(row) : undefined;
    },

    /**
     * Ends every pause older than 5 minutes. Returns, for each member of a pair, the latest line from its partner it
     * has not read, since lines posted during the pause rang nobody. The pause start stays, so the next run counts from it.
     */
    endPauses() {
      return transaction(() => {
        const cutoff = new Date(now().getTime() - LOOP_GUARD_PAUSE_MS).toISOString();
        return sql.duePauses.all(cutoff).flatMap(row => {
          const roomId = String(row.room_id);
          sql.endPause.run(roomId, String(row.name));
          const missed = sql.lastUnreadFrom.get(roomId, String(row.paused_with), Number(row.cursor));
          return missed ? [{ message: toMessage(missed), room: String(row.room_name) }] : [];
        });
      });
    },

    /** Who each paused member is paused with in a room. Lines between them ring nobody until the pause ends. */
    pausedWith(roomName: string) {
      const room = findRoom(roomName);
      return room ? pausedIn(room) : {};
    },

    /** Every room by name, closed ones too, with how many member posts it holds. */
    listRooms() {
      return sql.rooms.all().map(row => roomSummarySchema.parse(withStanding(row)));
    },

    /**
     * Posts as a member. Mentions are read against current members, and `missing` names the ones not here.
     * Closes the room when every agent is done unless the room is standing. Only the human can post into a closed
     * room, and that reopens it.
     */
    postMessage({
      done = false,
      from,
      room: roomName,
      text,
    }: {
      done?: boolean;
      from: string;
      room: string;
      text: string;
    }) {
      if (text.length > TEXT_MAX_CHARS) return { length: text.length, ok: false, reason: 'too_long' } as const;
      return transaction(emit => {
        const found = seat(roomName, from);
        if (!found.ok) return found;
        const { member } = found;
        if (member.muted) return { ok: false, reason: 'muted' } as const;
        const human = member.kind === 'human';
        let { room } = found;
        if (room.closed_at !== null) {
          if (!human) return { ok: false, reason: 'room_closed' } as const;
          room = reopen(room, emit);
        }
        return { ...speak({ done, member, room, text }, emit), ok: true } as const;
      });
    },

    /** Replaces the text of the member's last post if it is under 5 minutes old. Mentions are read again but nobody
     * is rung and no held note is made. */
    editPost(input: { as: string; room: string; text: string }) {
      return transaction(emit => rewriteLastPost(input, emit));
    },

    /** Takes back the member's last post if it is under 5 minutes old: the text goes, the line stays marked removed. */
    removePost({ as, room }: { as: string; room: string }) {
      return transaction(emit => rewriteLastPost({ as, room, text: null }, emit));
    },

    /**
     * Messages after the member's cursor, minus its own, at most 50, and moves the cursor.
     * With `afterId` it reads from that point and leaves the cursor alone.
     */
    readUnseen({
      afterId,
      as,
      limit = READ_LIMIT,
      room: roomName,
    }: {
      afterId?: number;
      as: string;
      limit?: number;
      room: string;
    }) {
      return transaction(emit => {
        const found = seat(roomName, as);
        if (!found.ok) return found;
        const { member, room } = found;
        const take = Math.min(limit, READ_LIMIT);
        const rows = sql.unseen.all(room.id, afterId ?? member.cursor, as, take + 1);
        const notes = afterId === undefined ? sql.noteMessages.all(room.id, as, noteCutoff()).map(toMessage) : [];
        if (notes.length) sql.dropNotes.run(room.id, as);
        const noted = new Set(notes.map(note => note.id));
        const page = rows.slice(0, take).map(toMessage);
        const messages = [...notes, ...page.filter(message => !noted.has(message.id))];
        const more = rows.length > take;
        if (afterId === undefined) {
          const last = more ? page.at(-1)!.id : Number(sql.latestId.get(room.id)?.id ?? member.cursor);
          if (last > member.cursor) sql.moveCursor.run(last, room.id, as);
        }
        setPresence(room, member, 'active', emit, true);
        return { messages, more, ok: true } as const;
      });
    },

    /** Messages whose text has every word of `q` (as a word start), newest first, each with its room name. */
    searchMessages({ limit = SEARCH_LIMIT, q, room: roomName }: { limit?: number; q: string; room?: string }) {
      const room = roomName === undefined ? undefined : findRoom(roomName);
      if (roomName !== undefined && !room) return { ok: false, reason: 'no_room' } as const;
      const match = ftsQuery(q);
      const roomId = room?.id ?? null;
      const rows = match ? sql.search.all(match, roomId, roomId, limit) : [];
      return { messages: rows.map(row => ({ ...toMessage(row), room: String(row.room) })), ok: true } as const;
    },

    /** Reopens a closed room. */
    reopenRoom(roomName: string) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        if (room.closed_at === null) return { ok: false, reason: 'open' } as const;
        return { ok: true, room: reopen(room, emit) } as const;
      });
    },

    /** Records an agent's tool ask on every seat its session holds, under one new id. A seat not in the room is skipped.
     * Claude Code opens one dialog at a time, so a new ask means the session's older one closed, maybe in its terminal. */
    openApproval({
      description,
      inputPreview,
      requestId,
      seats,
      session,
      tool,
    }: {
      description: string;
      inputPreview: string;
      requestId: string;
      seats: { name: string; room: string }[];
      session: string;
      tool: string;
    }) {
      return transaction(emit => {
        const id = randomUUID();
        const at = stamp();
        settled(sql.expireSessionApprovals.all(at, session), emit);
        return seats.flatMap(({ name, room: roomName }) => {
          const room = findRoom(roomName);
          const member = room && findMember(room, name);
          if (!room || !member || member.left_at !== null) return [];
          const row = sql.insertApproval.get(
            id,
            room.id,
            name,
            session,
            requestId,
            clip(tool),
            clip(description),
            clip(inputPreview),
            at,
          )!;
          const approval = toApproval(row);
          emit({ approval, room: room.name, type: 'approval' });
          return [approval];
        });
      });
    },

    /** Answers a pending ask by its exact id, once. Hands back the session and request id the verdict goes to. */
    answerApproval({ behavior, id }: { behavior: ApprovalBehavior; id: string }) {
      return transaction(emit => {
        const rows = sql.answerApproval.all(ANSWERED[behavior], stamp(), id);
        const [ask] = settled(rows, emit);
        if (!ask) return { ok: false, reason: 'no_approval' } as const;
        return { approvals: rows.map(toApproval), ok: true, ...ask } as const;
      });
    },

    /** Expires the asks of one ended session, or else every ask nobody answered in 10 minutes. Returns each ask to deny. */
    expireApprovals({ session }: { session?: string } = {}) {
      return transaction(emit => {
        const at = now();
        const rows =
          session === undefined
            ? sql.expireOldApprovals.all(at.toISOString(), new Date(at.getTime() - APPROVAL_TTL_MS).toISOString())
            : sql.expireSessionApprovals.all(at.toISOString(), session);
        return settled(rows, emit);
      });
    },

    /** The asks in a room still waiting for the human, oldest first. */
    pendingApprovals(roomName: string) {
      const room = findRoom(roomName);
      return room ? sql.pendingApprovals.all(room.id).map(toApproval) : [];
    },

    /** Posts an agent's question to the human as its own line and keeps it open for the human's pick.
     * A newer ask from the same seat replaces its open one, so each agent waits on one question per room. */
    askQuestion({ as, questions, room: roomName }: { as: string; questions: QuestionItem[]; room: string }) {
      return transaction(emit => {
        const found = seat(roomName, as);
        if (!found.ok) return found;
        const { member, room } = found;
        if (member.muted) return { ok: false, reason: 'muted' } as const;
        if (room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
        const at = stamp();
        questionsSql.replace.all(at, room.id, as).forEach(row => questionChanged(toQuestion(row), emit));
        const { message } = speak({ done: false, member, room, text: askText({ questions }) }, emit);
        const row = questionsSql.insert.get(randomUUID(), room.id, as, message.id, JSON.stringify(questions), at)!;
        return { ok: true, question: questionChanged(toQuestion(row), emit) } as const;
      });
    },

    /** The human's pick on an open question, once. Its line names the asker, so the doorbell rings it. */
    answerQuestion({ answers, id }: { answers: { other?: string | null; picks: number[] }[]; id: string }) {
      return transaction(emit => {
        const row = questionsSql.open.get(id);
        if (!row) return { ok: false, reason: 'no_question' } as const;
        const stored = storedAnswers(answers);
        if (!answersFit({ answers: stored, items: toQuestion(row).questions })) {
          return { ok: false, reason: 'bad_answer' } as const;
        }
        let room = roomById(String(row.room_id));
        const human = addHuman(room, emit);
        if (room.closed_at !== null) room = reopen(room, emit);
        const question = questionChanged(
          toQuestion(questionsSql.answer.get(JSON.stringify(stored), stamp(), id)!),
          emit,
        );
        const { message } = speak({ done: false, member: human, room, text: answerText(question) }, emit);
        return { message, ok: true, question } as const;
      });
    },

    /** Posts the hand-off line for each review request quiet 15 minutes, and returns the reviewers to ring
     * again for those quiet 10. Rooms with nudges off are skipped. */
    nudgeReviews() {
      return transaction(emit => {
        const at = now();
        const since = new Date(at.getTime() - REVIEW_NUDGE_WINDOW_MS).toISOString();
        return sql.nudgeRooms.all().flatMap(row => {
          const room = toRoom(row);
          const members = sql.liveMembers.all(room.id).map(toMember);
          const messages = sql.linesSince.all(room.id, since).map(toMessage);
          return reviewNudges({ members, messages, now: at }).flatMap(nudge => {
            if (nudge.kind === 'line') {
              post(room, SYSTEM_NAME, 'system', nudge.text, nudge.mentions, emit);
              return [];
            }
            const reviewer = members.find(member => member.name === nudge.reviewer);
            if (!reviewer || reviewer.kind === 'human') return [];
            const { id, url, worker } = nudge;
            return [{ id, kind: reviewer.kind, reviewer: reviewer.name, room: room.name, url, worker }];
          });
        });
      });
    },

    /** Turns review nudges on or off in a room with a line. Setting the state it already has writes nothing. */
    setReviewNudges({ on, room: roomName }: { on: boolean; room: string }) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        if (sql.reviewNudges.get(room.id)?.review_nudges === (on ? 1 : 0)) return { ok: true } as const;
        sql.setReviewNudges.run(on ? 1 : 0, room.id);
        systemLine(room, `review nudges turned ${on ? 'on' : 'off'}`, emit);
        return { ok: true } as const;
      });
    },

    /** Closes every question left open 30 minutes, each with a daemon line that rings its asker. */
    expireQuestions() {
      return transaction(emit => {
        const at = now();
        const cutoff = new Date(at.getTime() - QUESTION_TTL_MS).toISOString();
        return questionsSql.expireOld.all(at.toISOString(), cutoff).map(row => {
          const question = questionChanged(toQuestion(row), emit);
          const room = roomById(String(row.room_id));
          post(room, SYSTEM_NAME, 'system', expiryText(question), [question.member], emit);
          return question;
        });
      });
    },

    /** The questions in a room still waiting for the human, oldest first. */
    openQuestions(roomName: string) {
      const room = findRoom(roomName);
      return room ? questionsSql.openIn.all(room.id).map(toQuestion) : [];
    },

    /** The questions in a room answered, replaced or expired, oldest first, asked at or after `fromMessage`. */
    settledQuestions(roomName: string, { fromMessage = 0 }: { fromMessage?: number } = {}) {
      const room = findRoom(roomName);
      return room ? questionsSql.settledIn.all(room.id, fromMessage).map(toQuestion) : [];
    },

    /** One seat's open questions in a room, oldest first. */
    questionsOf({ as, room: roomName }: { as: string; room: string }) {
      const room = findRoom(roomName);
      return room ? questionsSql.openOf.all(room.id, as).map(toQuestion) : [];
    },

    /** Posts a proposal as the proposer's own line, which rings every agent it names, and keeps it open under that line's id.
     * With `replaces`, it must name every party of that open or settled agreement, which stays live until this one settles. */
    proposeAgreement({
      as,
      replaces,
      room: roomName,
      text,
      with: named,
    }: {
      as: string;
      replaces?: number;
      room: string;
      text: string;
      with: readonly string[];
    }) {
      return transaction(emit => {
        const found = speaker(roomName, as);
        if (!found.ok) return found;
        const { member, room } = found;
        const names = [...new Set(named)];
        if (names.includes(as)) return { ok: false, reason: 'self' } as const;
        const missing = names.filter(name => {
          const other = findMember(room, name);
          return !other || other.left_at !== null || !isAgent(other);
        });
        if (missing.length) return { missing, ok: false, reason: 'not_in_room' } as const;
        const old = replaces === undefined ? undefined : liveAgreement(room, replaces);
        if (old && !old.ok) return old;
        if (old && !involves({ agreement: old.agreement, as })) return { ok: false, reason: 'not_named' } as const;
        const left = old ? leftOut({ agreement: old.agreement, as, names }) : [];
        if (left.length) return { missing: left, ok: false, reason: 'missing_parties' } as const;
        const line = proposalText({ replaces: replaces ?? null, text, with: names });
        const { message } = speak({ done: false, member, room, text: line }, emit);
        const row = agreementsSql.insert.get(
          message.id,
          room.id,
          as,
          text,
          JSON.stringify(names),
          replaces ?? null,
          stamp(),
        )!;
        return { agreement: agreementChanged(toAgreement(row), emit), ok: true } as const;
      });
    },

    /** A named agent says yes. Once every named agent has, the agreement is settled with a messhall line to the proposer,
     * and the agreement it replaces, if still live, becomes replaced. */
    confirmAgreement({ as, id, room: roomName }: { as: string; id: number; room: string }) {
      return transaction(emit => {
        const found = speaker(roomName, as);
        if (!found.ok) return found;
        const { room } = found;
        const agreement = findAgreement(room, id);
        if (!agreement) return { ok: false, reason: 'no_agreement' } as const;
        if (agreement.state !== 'open') return { ok: false, reason: 'not_open' } as const;
        if (!agreement.with.includes(as)) return { ok: false, reason: 'not_named' } as const;
        if (agreement.confirmed.includes(as)) return { ok: false, reason: 'already_confirmed' } as const;
        const confirmed = [...agreement.confirmed, as];
        const allIn = agreement.with.every(name => confirmed.includes(name));
        const row = agreementsSql.confirm.get(
          JSON.stringify(confirmed),
          allIn ? 'settled' : 'open',
          allIn ? stamp() : null,
          id,
        )!;
        const updated = agreementChanged(toAgreement(row), emit);
        if (allIn) post(room, SYSTEM_NAME, 'system', settledText(updated), [updated.proposer], emit);
        const replaced = allIn && updated.replaces !== null ? liveAgreement(room, updated.replaces) : undefined;
        if (replaced?.ok) {
          agreementChanged(toAgreement(agreementsSql.replace.get(stamp(), replaced.agreement.id)!), emit);
        }
        return { agreement: updated, ok: true } as const;
      });
    },

    /** A named agent says no to an open or settled agreement, with why as its own line to the proposer. */
    rejectAgreement({ as, id, room: roomName, why }: { as: string; id: number; room: string; why: string }) {
      return transaction(emit => {
        const found = speaker(roomName, as);
        if (!found.ok) return found;
        const { member, room } = found;
        const live = liveAgreement(room, id);
        if (!live.ok) return live;
        if (!live.agreement.with.includes(as)) return { ok: false, reason: 'not_named' } as const;
        const agreement = agreementChanged(toAgreement(agreementsSql.reject.get(as, why, stamp(), id)!), emit);
        speak({ done: false, member, room, text: rejectText({ id, proposer: agreement.proposer, why }) }, emit);
        return { agreement, ok: true } as const;
      });
    },

    /** The open and settled agreements in a room, oldest first. */
    agreementsIn(roomName: string) {
      const room = findRoom(roomName);
      return room ? agreementsSql.live.all(room.id).map(toAgreement) : [];
    },

    /** Marks every agent still in a room reconnecting, with one line per open room, and expires every pending ask.
     * For daemon start, when no session is left. The sweep turns them away 2 minutes later. */
    markReconnecting() {
      return transaction(emit => {
        restartedAt = now();
        settled(sql.expireAllApprovals.all(stamp()), emit);
        const changes = sql.sweepable.all().flatMap(row => {
          const member = toMember(row);
          if (member.presence === 'reconnecting') return [];
          sql.setPresence.run('reconnecting', member.room_id, member.name);
          const room = roomById(member.room_id);
          emit({ from: member.presence, name: member.name, room: room.name, to: 'reconnecting', type: 'presence' });
          const to = 'reconnecting';
          const change: PresenceChange = { from: member.presence, name: member.name, room: room.name, to };
          return [{ change, room }];
        });
        const open = changes.filter(({ room }) => room.closed_at === null);
        Map.groupBy(open, ({ room }) => room.id).forEach(group => {
          const names = group.map(({ change }) => change.name);
          const verb = names.length > 1 ? 'are' : 'is';
          systemLine(group[0]!.room, `messhall restarted, ${LIST.format(names)} ${verb} reconnecting`, emit);
        });
        return changes.map(({ change }) => change);
      });
    },

    /** The reconnecting and away seats, with the kind and seat key the wake needs to reach each agent.
     * An away seat may still hold a live pane that an earlier restart missed. */
    wakeableSeats() {
      return sql.wakeable.all().map(row => ({
        kind: AGENT_KIND.parse(row.kind),
        name: String(row.name),
        room: String(row.room),
        seatKey: typeof row.seat_key === 'string' ? row.seat_key : null,
      }));
    },

    /** Moves agents along with the clock: active to idle at 2 minutes, anything to away at 30 unless `ringable`
     * says its doorbell still reaches it. The human is left alone. */
    sweepPresence({ ringable }: { ringable: (seat: { name: string; room: string }) => boolean }) {
      return transaction(emit => {
        const at = now();
        return sql.sweepable.all().flatMap(row => {
          const member = toMember(row);
          const room = roomById(member.room_id);
          const to = nextPresence({
            member,
            now: at,
            restartedAt,
            ringable: ringable({ name: member.name, room: room.name }),
          });
          if (to === member.presence) return [];
          setPresence(room, member, to, emit, false);
          const change: PresenceChange = { from: member.presence, name: member.name, room: room.name, to };
          return [change];
        });
      });
    },

    /** Drops agents who left 5 minutes ago. Away seats stay. Posts keep the sender's name and type, and a rejoin starts fresh. */
    clearStale() {
      return transaction(emit => {
        const cutoff = new Date(now().getTime() - STALE_AFTER_MS).toISOString();
        sql.dropOldNotes.run(noteCutoff());
        return sql.stale.all(cutoff).map(row => {
          const member = toMember(row);
          const room = roomById(member.room_id);
          drop(room, member, emit);
          return { name: member.name, room: room.name };
        });
      });
    },

    /** Drops any agent seat now, left, away or still here, the way the human kicks. The human seat is refused. */
    removeMember({ member: name, room: roomName }: { member: string; room: string }) {
      return transaction(emit => {
        const room = findRoom(roomName);
        if (!room) return { ok: false, reason: 'no_room' } as const;
        return kick(room, name, emit);
      });
    },

    /** Drops any agent seat now with a line naming `by`. Only an orchestrator in the room may, so `by` is checked first. */
    kickMember({ by, member: name, room: roomName }: { by: string; member: string; room: string }) {
      return transaction(emit => {
        const found = seat(roomName, by);
        if (!found.ok) return found;
        if (!canAssignRole({ by: found.member })) return { ok: false, reason: 'not_allowed' } as const;
        const kicked = kick(found.room, name, emit);
        if (kicked.ok) systemLine(found.room, `${name} was kicked by ${by}`, emit);
        return kicked;
      });
    },

    /** The seats a key holds, away ones too, by room. Left seats are not held. */
    seatsOf(key: string) {
      return sql.seats.all(key).map(row => ({
        kind: AGENT_KIND.parse(row.kind),
        name: String(row.name),
        room: String(row.room),
      }));
    },

    /** What a summary needs: posts so far, how many the last summary covered, that summary and the posts after it. */
    summaryState(roomName: string) {
      const room = findRoom(roomName);
      if (!room) return { ok: false, reason: 'no_room' } as const;
      const row = latestSummaryRow(room);
      const coversId = row ? Number(row.covers_id ?? 0) : 0;
      return {
        count: countPosts(room),
        lastSummaryAt: row ? Number(sql.countPostsUpTo.get(room.id, coversId)?.n) : null,
        messages: sql.postsAfter.all(room.id, coversId).map(toMessage),
        ok: true,
        previous: row ? toMessage(row) : undefined,
        room,
      } as const;
    },

    /** Records a call: `active` for any call, `waiting` while blocked in wait, `away` on session close. */
    touch({ as, room: roomName, state }: { as: string; room: string; state: TouchState }) {
      return transaction(emit => {
        const found = seat(roomName, as);
        if (!found.ok) return found;
        setPresence(found.room, found.member, state, emit, state !== 'away');
        return { member: findMember(found.room, as)!, ok: true } as const;
      });
    },
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;
