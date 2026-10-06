import type { BusEvent, MemberChange } from '../../contracts/events.ts';
import type { AgentKind, Launch, Member, MessageKind, Presence, Room } from '../../contracts/room.ts';
import type { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import {
  HUMAN_NAME,
  launchSchema,
  memberKindSchema,
  memberSchema,
  OBSERVER_ROLE,
  ORCHESTRATOR_ROLE,
  messageSchema,
  RESERVED_NAMES,
  roomSchema,
  roomSummarySchema,
  SYSTEM_NAME,
  TEXT_MAX_CHARS,
  UNASSIGNED_ROLE,
} from '../../contracts/room.ts';
import { INVITE_TTL_MS, LOOP_GUARD_LINES, READ_LIMIT, SEARCH_LIMIT, STALE_AFTER_MS } from '../config.js';
import { parseStoredJson } from '../lib/json.js';
import { clientType } from '../mcp/constants.js';

import { createEventBus } from './events.js';
import { canAssignRole, isAgent, loopPair, nextPresence, parseMentions } from './rules.js';

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

  const sql = {
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
    expiredInvites: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE presence = 'invited' AND joined_at <= ? ORDER BY rooms.name, members.name",
    ),
    latest: db.prepare('SELECT * FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id'),
    latestSummary: db.prepare("SELECT * FROM messages WHERE room_id = ? AND kind = 'summary' ORDER BY id DESC LIMIT 1"),
    lastPosts: db.prepare(
      `SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND ${IS_POST} ORDER BY id DESC LIMIT ?) ORDER BY id`,
    ),
    latestId: db.prepare('SELECT max(id) AS id FROM messages WHERE room_id = ?'),
    leave: db.prepare("UPDATE members SET left_at = ?, presence = 'left' WHERE room_id = ? AND name = ?"),
    liveMembers: db.prepare('SELECT * FROM members WHERE room_id = ? AND left_at IS NULL ORDER BY name'),
    member: db.prepare('SELECT * FROM members WHERE room_id = ? AND name = ?'),
    messagesAfter: db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? ORDER BY id LIMIT ?'),
    messagesBefore: db.prepare(
      'SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    ),
    paused: db.prepare('SELECT name, paused_with FROM members WHERE room_id = ? AND paused_with IS NOT NULL'),
    pause: db.prepare('UPDATE members SET paused_with = ? WHERE room_id = ? AND name = ?'),
    unpauseAll: db.prepare('UPDATE members SET paused_with = NULL WHERE room_id = ?'),
    postsAfter: db.prepare(`SELECT * FROM messages WHERE room_id = ? AND ${IS_POST} AND id > ? ORDER BY id`),
    moveCursor: db.prepare('UPDATE members SET cursor = ? WHERE room_id = ? AND name = ?'),
    rejoin: db.prepare(
      "UPDATE members SET kind = ?, client_name = ?, client_version = ?, seat_key = ?, left_at = NULL, last_seen_at = ?, presence = 'active', done = done * ? WHERE room_id = ? AND name = ?",
    ),
    reopen: db.prepare('UPDATE rooms SET closed_at = NULL WHERE id = ?'),
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
    setDone: db.prepare('UPDATE members SET done = ? WHERE room_id = ? AND name = ?'),
    setPresence: db.prepare('UPDATE members SET presence = ? WHERE room_id = ? AND name = ?'),
    stale: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE kind != 'human' AND left_at <= ? ORDER BY rooms.name, members.name",
    ),
    sweepable: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE left_at IS NULL AND kind != 'human' AND presence NOT IN ('away', 'invited') ORDER BY rooms.name, members.name",
    ),
    unseen: db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? AND from_name != ? ORDER BY id LIMIT ?'),
  };

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
  const findMember = (room: Room, name: string) => {
    const row = sql.member.get(room.id, name);
    return row ? toMember(row) : undefined;
  };
  const countPosts = (room: Room) => Number(sql.countPosts.get(room.id)?.n);
  const latestSummaryRow = (room: Room) => sql.latestSummary.get(room.id);
  // A new member starts where the latest summary stands, so its first read is that summary.
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
  function reclaims({ existing, holderDead, room, seatKey }: Reclaim) {
    const key = sql.seatKey.get(room.id, existing.name)?.seat_key;
    if (typeof key === 'string') return key === seatKey;
    return existing.presence === 'away' || holderDead;
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

  const pausedIn = (room: Room) =>
    Object.fromEntries(sql.paused.all(room.id).map(row => [String(row.name), String(row.paused_with)]));

  // Two agents trading lines alone pause each other once, and the human hears about it in the same write.
  function guardLoop(room: Room, emit: Emit) {
    const pair = loopPair({
      lines: LOOP_GUARD_LINES,
      posts: sql.lastPosts.all(room.id, LOOP_GUARD_LINES).map(toMessage),
    });
    if (!pair) return;
    const [a, b] = pair;
    const paused = pausedIn(room);
    if (paused[a] === b && paused[b] === a) return;
    sql.pause.run(b, room.id, a);
    sql.pause.run(a, room.id, b);
    const text = `@${HUMAN_NAME} ${a} and ${b} have traded ${LOOP_GUARD_LINES} lines with no one else, their doorbells are paused`;
    post(room, SYSTEM_NAME, 'system', text, [HUMAN_NAME], emit);
  }

  // Finds the room and a member still in it, the gate every member call goes through.
  function seat(roomName: string, name: string) {
    const room = findRoom(roomName);
    if (!room) return { ok: false, reason: 'no_room' } as const;
    const member = findMember(room, name);
    if (!member || member.left_at !== null) return { ok: false, reason: 'not_member' } as const;
    return { member, ok: true, room } as const;
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
    }) {
      if (isReserved(as)) return { ok: false, reason: 'name_reserved' } as const;
      return transaction(emit => {
        const found = findRoom(roomName);
        if (invite && !(found && findMember(found, as))) return { ok: false, reason: 'no_invite' } as const;
        const room = found ?? makeRoom({ createdBy: as, name: roomName }, emit);
        if (room.standing && room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
        const existing = findMember(room, as);
        const proof = invite ?? seatKey;
        if (existing && existing.left_at === null && !reclaims({ existing, holderDead, room, seatKey: proof })) {
          return { ok: false, reason: 'name_taken', suggestion: suggestName(room, as) } as const;
        }
        const change: MemberChange =
          existing?.left_at === null && existing.presence !== 'invited' ? 'reconnected' : 'joined';
        const cursor = startCursor(room);
        const [name, version] = [client?.name ?? null, client?.version ?? null];
        const role = observe ? OBSERVER_ROLE : as === ORCHESTRATOR_ROLE ? ORCHESTRATOR_ROLE : UNASSIGNED_ROLE;
        const seatKeyOrNull = seatKey ?? invite ?? null;
        if (existing) sql.rejoin.run(kind, name, version, seatKeyOrNull, stamp(), reattach ? 1 : 0, room.id, as);
        if (existing && observe) sql.setRole.run(OBSERVER_ROLE, null, as, room.id, as);
        if (!existing) {
          const at = stamp();
          sql.insertMember.run(room.id, as, kind, at, at, 'active', cursor, name, version, role, seatKeyOrNull);
        }
        const member = findMember(room, as)!;
        emit({ change, member, room: room.name, type: 'member' });
        systemLine(room, `${as} ${change}`, emit);
        return { change, member, ok: true, room } as const;
      });
    },

    /**
     * Makes a seat ahead of its agent: presence invited, with its role, instructions and how to launch it.
     * Only the human or an unmuted orchestrator may, and only the human makes an orchestrator.
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
        if (findMember(room, name)) {
          return { ok: false, reason: 'name_taken', suggestion: suggestName(room, name) } as const;
        }
        const seatKey = randomUUID();
        const at = stamp();
        const spec = JSON.stringify(launch);
        sql.insertInvite.run(
          room.id,
          name,
          launch.agent,
          at,
          at,
          startCursor(room),
          role,
          instructions ?? null,
          by,
          seatKey,
          spec,
        );
        const member = findMember(room, name)!;
        emit({ change: 'invited', member, room: room.name, type: 'member' });
        systemLine(room, `${name} invited by ${by} as ${role}`, emit);
        return { member, ok: true, seatKey } as const;
      });
    },

    /** How to start a member's agent, from its invite. Undefined for a member that joined on its own, or none. */
    launchOf({ name, room: roomName }: { name: string; room: string }) {
      const room = findRoom(roomName);
      const launch = room && sql.member.get(room.id, name)?.launch;
      return typeof launch === 'string' ? launchSchema.parse(parseStoredJson(launch)) : undefined;
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
        sql.leave.run(stamp(), found.room.id, as);
        emit({ change: 'left', member: findMember(found.room, as)!, room: found.room.name, type: 'member' });
        systemLine(found.room, note ? `${as} left: ${note}` : `${as} left`, emit);
        return { ok: true } as const;
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

    /** Who each paused member is paused with in a room. Lines between them ring nobody until the human posts. */
    pausedWith(roomName: string) {
      const room = findRoom(roomName);
      return room ? pausedIn(room) : {};
    },

    /** Every room by name, closed ones too, with how many member posts it holds. */
    listRooms() {
      return sql.rooms.all().map(row => roomSummarySchema.parse(withStanding(row)));
    },

    /**
     * Posts as a member. Mentions are read against current members. Closes the room when every agent is done
     * unless the room is standing. Only the human can post into a closed room, and that reopens it.
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
        const names = sql.liveMembers.all(room.id).map(row => String(row.name));
        const kind = done && !human ? 'done' : 'chat';
        const message = post(room, member, kind, text, parseMentions({ names, text }), emit);
        sql.setDone.run(kind === 'done' ? 1 : 0, room.id, from);
        setPresence(room, member, 'active', emit, true);
        if (human) sql.unpauseAll.run(room.id);
        else guardLoop(room, emit);
        if (kind === 'done') closeIfAllDone(room, emit);
        return { message, ok: true } as const;
      });
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
        const messages = rows.slice(0, take).map(toMessage);
        const more = rows.length > take;
        if (afterId === undefined) {
          const last = more ? messages.at(-1)!.id : Number(sql.latestId.get(room.id)?.id ?? member.cursor);
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

    /** Marks every agent still in a room away, with one line per open room. For daemon start, when no session is left. */
    markAllAway() {
      return transaction(emit => {
        const changes = sql.sweepable.all().map(row => {
          const member = toMember(row);
          sql.setPresence.run('away', member.room_id, member.name);
          const room = roomById(member.room_id);
          emit({ from: member.presence, name: member.name, room: room.name, to: 'away', type: 'presence' });
          const change: PresenceChange = { from: member.presence, name: member.name, room: room.name, to: 'away' };
          return { change, room };
        });
        const open = changes.filter(({ room }) => room.closed_at === null);
        Map.groupBy(open, ({ room }) => room.id).forEach(group => {
          const names = group.map(({ change }) => change.name);
          const verb = names.length > 1 ? 'are' : 'is';
          systemLine(group[0]!.room, `messhall restarted, ${LIST.format(names)} ${verb} away`, emit);
        });
        return changes.map(({ change }) => change);
      });
    },

    /** Moves agents along with the clock: active to idle at 2 minutes, anything to away at 30. The human is left alone. */
    sweepPresence() {
      return transaction(emit => {
        const at = now();
        return sql.sweepable.all().flatMap(row => {
          const member = toMember(row);
          const to = nextPresence({ member, now: at });
          if (to === member.presence) return [];
          const room = roomById(member.room_id);
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
