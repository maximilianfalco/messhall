import type { AgentKind } from '../../contracts/room.ts';

import { DOORBELL_CHECK_MS, SESSION_DEAD_MS } from '../config.js';

/**
 * What the daemon knows about one MCP session: the name it holds in each room, its agent kind,
 * when it was last seen, how many HTTP requests it has open right now, and the seat key it sent.
 */
export function createSession({ id, now, seat }: { id: string; now: () => Date; seat?: string }) {
  const rooms = new Map<string, string>();
  const marks = new Map<string, number>();
  let called = false;
  let channel = false;
  let check: { acked: boolean; id: string; sentAt: number; told: boolean } | undefined;
  let kind: AgentKind = 'other';
  let lastSeen = now().getTime();
  let open = 0;
  let threadId: string | undefined;

  return {
    /** Holds `name` in `room` for this session. `mark` is the newest message id when it joined. */
    bind(binding: {
      channel?: boolean;
      kind: AgentKind;
      mark?: number;
      name: string;
      room: string;
      threadId?: string;
    }) {
      if (!rooms.has(binding.room)) marks.set(binding.room, binding.mark ?? 0);
      rooms.set(binding.room, binding.name);
      ({ kind } = binding);
      channel = binding.channel ?? false;
      // A codex thread id is only passed once thread/read has checked it.
      if (binding.threadId) ({ threadId } = binding);
    },
    /** Starts the doorbell check: the test ring `ring` went out now and waits for doorbell_ok. */
    checkDoorbell(ring: string) {
      check = { acked: false, id: ring, sentAt: now().getTime(), told: false };
    },
    /** Takes the answer to the test ring. A late answer still counts. False when `ring` is not the ring sent. */
    ackDoorbell(ring: string) {
      if (check?.id !== ring) return false;
      check.acked = true;
      return true;
    },
    /** Whether the test ring got an answer: on, still checking, or off after the check timed out. */
    get doorbell(): 'checking' | 'off' | 'on' | 'unchecked' {
      if (!check) return 'unchecked';
      if (check.acked) return 'on';
      return now().getTime() - check.sentAt >= DOORBELL_CHECK_MS ? 'off' : 'checking';
    },
    /** True the first time it is asked after the doorbell reads off, so the agent is told once. */
    tellDoorbellOff() {
      if (!check || check.told || this.doorbell !== 'off') return false;
      check.told = true;
      return true;
    },
    /** Forgets the codex thread after a ring failed, so the member falls back to wait. */
    dropThread() {
      threadId = undefined;
    },
    /** Counts one open HTTP request until the returned function runs. */
    hold() {
      open += 1;
      lastSeen = now().getTime();
      return () => {
        open -= 1;
        lastSeen = now().getTime();
      };
    },
    id,
    /** The newest message id when this session joined `room`. Older unread posts are backlog. */
    markOf(room: string) {
      return marks.get(room) ?? 0;
    },
    /** True when no request is open, the GET stream too, and none came for a minute. Its client most likely died. */
    dead() {
      return open === 0 && now().getTime() - lastSeen >= SESSION_DEAD_MS;
    },
    /** True once the client made a tool call here. A reconnect opens sessions it never uses. */
    get called() {
      return called;
    },
    /** True when the client takes `notifications/claude/channel`, so the channel ringer can reach it. */
    get channel() {
      return channel;
    },
    /** True when a ringer can reach this session: a Claude channel that did not fail its check, or a checked codex thread. */
    get ringable() {
      return (channel && this.doorbell !== 'off') || (kind === 'codex' && threadId !== undefined);
    },
    get kind() {
      return kind;
    },
    get lastSeen() {
      return lastSeen;
    },
    get open() {
      return open;
    },
    rooms: rooms as ReadonlyMap<string, string>,
    /** The seat key from the client's header at initialize, so its seats come back after a reconnect. */
    seat,
    /** Stamps a tool call. */
    seen() {
      called = true;
      lastSeen = now().getTime();
    },
    get threadId() {
      return threadId;
    },
    /** Lets go of `room`, after a leave, a takeover or the end of the session. */
    unbind(room: string) {
      rooms.delete(room);
      marks.delete(room);
    },
  };
}

export type McpSession = ReturnType<typeof createSession>;

/** The live sessions by id, so a takeover can unbind the old holder and the doorbell can find a member's session. */
export function createSessionRegistry<Entry extends { session: McpSession }>() {
  const entries = new Map<string, Entry>();
  return {
    add(entry: Entry) {
      entries.set(entry.session.id, entry);
    },
    all() {
      return [...entries.values()];
    },
    get(id: string) {
      return entries.get(id);
    },
    remove(id: string) {
      entries.delete(id);
    },
    /** Every session that holds `name` in `room`. At most one, since a join unbinds the old holder. */
    sessionsFor({ name, room }: { name: string; room: string }) {
      return [...entries.values()].filter(entry => entry.session.rooms.get(room) === name);
    },
  };
}

export type SessionRegistry<Entry extends { session: McpSession }> = ReturnType<typeof createSessionRegistry<Entry>>;
