import type { BusEvent, MemberChange } from '../../contracts/events.ts';
import type { AgentKind, Member, MessageKind, Presence, Room } from '../../contracts/room.ts';
import type { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import {
  HUMAN_NAME,
  memberSchema,
  ORCHESTRATOR_ROLE,
  messageSchema,
  RESERVED_NAMES,
  roomSchema,
  roomSummarySchema,
  SYSTEM_NAME,
  TEXT_MAX_CHARS,
  UNASSIGNED_ROLE,
} from '../../contracts/room.ts';
import { READ_LIMIT, SEARCH_LIMIT, STALE_AFTER_MS } from '../config.js';
import { parseStoredJson } from '../lib/json.js';
import { clientType } from '../mcp/constants.js';

import { createEventBus } from './events.js';
import { canAssignRole, nextPresence, parseMentions } from './rules.js';

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
  });
const toMessage = (row: Row) =>
  messageSchema.parse({ ...row, from: row.from_name, mentions: parseStoredJson(String(row.mentions)) });

// Each word becomes a quoted prefix term, so FTS5 syntax in a query is just text.
const ftsQuery = (q: string) => Array.from(q.matchAll(/[\p{L}\p{N}_]+/gu), ([word]) => `"${word}"*`).join(' ');

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

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
    agentsNotDone: db.prepare(
      "SELECT count(*) AS n FROM members WHERE room_id = ? AND left_at IS NULL AND kind != 'human' AND done = 0",
    ),
    closeRoom: db.prepare('UPDATE rooms SET closed_at = ? WHERE id = ?'),
    countPosts: db.prepare(`SELECT count(*) AS n FROM messages WHERE room_id = ? AND ${IS_POST}`),
    countPostsUpTo: db.prepare(`SELECT count(*) AS n FROM messages WHERE room_id = ? AND ${IS_POST} AND id <= ?`),
    insertMember: db.prepare(
      'INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence, cursor, client_name, client_version, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
    latest: db.prepare('SELECT * FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id'),
    latestSummary: db.prepare("SELECT * FROM messages WHERE room_id = ? AND kind = 'summary' ORDER BY id DESC LIMIT 1"),
    latestId: db.prepare('SELECT max(id) AS id FROM messages WHERE room_id = ?'),
    leave: db.prepare("UPDATE members SET left_at = ?, presence = 'left' WHERE room_id = ? AND name = ?"),
    liveMembers: db.prepare('SELECT * FROM members WHERE room_id = ? AND left_at IS NULL ORDER BY name'),
    member: db.prepare('SELECT * FROM members WHERE room_id = ? AND name = ?'),
    messagesAfter: db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? ORDER BY id LIMIT ?'),
    messagesBefore: db.prepare(
      'SELECT * FROM (SELECT * FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    ),
    postsAfter: db.prepare(`SELECT * FROM messages WHERE room_id = ? AND ${IS_POST} AND id > ? ORDER BY id`),
    moveCursor: db.prepare('UPDATE members SET cursor = ? WHERE room_id = ? AND name = ?'),
    rejoin: db.prepare(
      "UPDATE members SET kind = ?, client_name = ?, client_version = ?, left_at = NULL, gone_at = NULL, last_seen_at = ?, presence = 'active', done = 0 WHERE room_id = ? AND name = ?",
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
    seen: db.prepare(
      'UPDATE members SET presence = ?, last_seen_at = ?, gone_at = NULL WHERE room_id = ? AND name = ?',
    ),
    setRole: db.prepare(
      'UPDATE members SET role = ?, role_instructions = ?, role_set_by = ? WHERE room_id = ? AND name = ?',
    ),
    setDone: db.prepare('UPDATE members SET done = ? WHERE room_id = ? AND name = ?'),
    setPresence: db.prepare('UPDATE members SET presence = ?, gone_at = ? WHERE room_id = ? AND name = ?'),
    stale: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE kind != 'human' AND coalesce(left_at, gone_at) <= ? ORDER BY rooms.name, members.name",
    ),
    sweepable: db.prepare(
      "SELECT members.* FROM members JOIN rooms ON rooms.id = members.room_id WHERE left_at IS NULL AND kind != 'human' AND presence != 'gone' ORDER BY rooms.name, members.name",
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
    if (!seen) sql.setPresence.run(to, to === 'gone' ? stamp() : null, room.id, member.name);
    emit({ from: member.presence, name: member.name, room: room.name, to, type: 'presence' });
    if (to === 'gone') systemLine(room, `${member.name} is gone`, emit);
  }

  function addHuman(room: Room, emit: Emit) {
    const existing = findMember(room, HUMAN_NAME);
    if (existing) return existing;
    sql.insertMember.run(room.id, HUMAN_NAME, 'human', stamp(), stamp(), 'idle', 0, null, null, UNASSIGNED_ROLE);
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
     * Joins `as` to the room, making the room on first join. A gone holder, or one whose session is
     * dead (`holderDead`), is taken over with its cursor ("reconnected"). A live holder gives
     * `name_taken` with a free name to try. A closed standing room waits for the human to reopen it.
     */
    joinRoom({
      as,
      client,
      holderDead = false,
      kind,
      room: roomName,
    }: {
      as: string;
      client?: { name: string; version: string };
      holderDead?: boolean;
      kind: AgentKind;
      room: string;
    }) {
      if (isReserved(as)) return { ok: false, reason: 'name_reserved' } as const;
      return transaction(emit => {
        const room = findRoom(roomName) ?? makeRoom({ createdBy: as, name: roomName }, emit);
        if (room.standing && room.closed_at !== null) return { ok: false, reason: 'room_closed' } as const;
        const existing = findMember(room, as);
        if (existing && existing.left_at === null && existing.presence !== 'gone' && !holderDead) {
          return { ok: false, reason: 'name_taken', suggestion: suggestName(room, as) } as const;
        }
        const change: MemberChange = existing?.left_at === null ? 'reconnected' : 'joined';
        // A new member starts where the latest summary stands, so its first read is that summary.
        const cursor = Number(latestSummaryRow(room)?.covers_id ?? 0);
        const [name, version] = [client?.name ?? null, client?.version ?? null];
        const role = as === ORCHESTRATOR_ROLE ? ORCHESTRATOR_ROLE : UNASSIGNED_ROLE;
        if (existing) sql.rejoin.run(kind, name, version, stamp(), room.id, as);
        else sql.insertMember.run(room.id, as, kind, stamp(), stamp(), 'active', cursor, name, version, role);
        const member = findMember(room, as)!;
        emit({ change, member, room: room.name, type: 'member' });
        systemLine(room, `${as} ${change}`, emit);
        return { change, member, ok: true, room } as const;
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
        if (!room.standing && kind === 'done' && Number(sql.agentsNotDone.get(room.id)?.n) === 0) {
          close(room, 'all done, room closed', emit);
        }
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

    /** Marks every agent still in a room gone, with one line per open room. For daemon start, when no session is left. */
    markAllGone() {
      return transaction(emit => {
        const changes = sql.sweepable.all().map(row => {
          const member = toMember(row);
          sql.setPresence.run('gone', stamp(), member.room_id, member.name);
          const room = roomById(member.room_id);
          emit({ from: member.presence, name: member.name, room: room.name, to: 'gone', type: 'presence' });
          const change: PresenceChange = { from: member.presence, name: member.name, room: room.name, to: 'gone' };
          return { change, room };
        });
        const open = changes.filter(({ room }) => room.closed_at === null);
        Map.groupBy(open, ({ room }) => room.id).forEach(group => {
          const names = group.map(({ change }) => change.name);
          const verb = names.length > 1 ? 'are' : 'is';
          systemLine(group[0]!.room, `messhall restarted, ${LIST.format(names)} ${verb} gone`, emit);
        });
        return changes.map(({ change }) => change);
      });
    },

    /** Moves agents along with the clock: active to idle at 2 minutes, anything to gone at 30. The human is left alone. */
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

    /** Drops agents left or gone for 30 minutes. Their posts keep the sender's name and type, and a rejoin starts fresh. */
    clearStale() {
      return transaction(emit => {
        const cutoff = new Date(now().getTime() - STALE_AFTER_MS).toISOString();
        return sql.stale.all(cutoff).map(row => {
          const member = toMember(row);
          const room = roomById(member.room_id);
          sql.removeMember.run(member.room_id, member.name);
          emit({ change: 'removed', member, room: room.name, type: 'member' });
          return { name: member.name, room: room.name };
        });
      });
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

    /** Records a call: `active` for any call, `waiting` while blocked in wait, `gone` on session close. */
    touch({ as, room: roomName, state }: { as: string; room: string; state: TouchState }) {
      return transaction(emit => {
        const found = seat(roomName, as);
        if (!found.ok) return found;
        setPresence(found.room, found.member, state, emit, state !== 'gone');
        return { member: findMember(found.room, as)!, ok: true } as const;
      });
    },
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;
