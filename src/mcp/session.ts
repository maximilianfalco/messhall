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
  let check: { acked: boolean; ids: Set<string>; sentAt: number; told: boolean } | undefined;
  let kind: AgentKind = 'other';
  let lastSeen = now().getTime();
  let open = 0;
  const ports = new Map<number, number>();
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
    /** Starts a doorbell check: the test ring `ring` went out now and waits for doorbell_ok. Ids of earlier rings still count. */
    checkDoorbell(ring: string) {
      check = { acked: false, ids: new Set(check?.ids).add(ring), sentAt: now().getTime(), told: check?.told ?? false };
    },
    /** Takes the answer to a test ring. A late answer still counts. False when `ring` is not a ring sent. */
    ackDoorbell(ring: string) {
      if (!check?.ids.has(ring)) return false;
      check.acked = true;
      return true;
    },
    /** Starts a new check on a rejoin, so a lost test ring gets another. A doorbell that reads on stays on. */
    recheckDoorbell() {
      if (this.doorbell !== 'on') check = undefined;
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
    /** Counts one open HTTP request until the returned function runs. `port` is the client's side of its socket. */
    hold(port?: number) {
      open += 1;
      lastSeen = now().getTime();
      if (port !== undefined) ports.set(port, (ports.get(port) ?? 0) + 1);
      return () => {
        open -= 1;
        lastSeen = now().getTime();
        if (port === undefined) return;
        const left = (ports.get(port) ?? 1) - 1;
        if (left === 0) ports.delete(port);
        else ports.set(port, left);
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
    /** True when a ringer can reach this session: a Claude channel, even one that failed its check, or a checked codex thread. */
    get ringable() {
      return channel || (kind === 'codex' && threadId !== undefined);
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
    /** The client ports of its open requests, so a scan can tell which process holds its seats. */
    get ports() {
      return [...ports.keys()];
    },
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
    /** Each seated session's open client ports, so a scan can find the process behind its seats. */
    peers() {
      return [...entries.values()].flatMap(({ session }) => {
        const seats = [...session.rooms].map(([room, name]) => ({ name, room }));
        return seats.length > 0 && session.ports.length > 0 ? [{ kind: session.kind, ports: session.ports, seats }] : [];
      });
    },
    /** Each seat a codex session holds, with its thread. */
    threadSeats() {
      return [...entries.values()].flatMap(({ session }) => {
        const { threadId } = session;
        return threadId ? [...session.rooms].map(([room, name]) => ({ name, room, threadId })) : [];
      });
    },
  };
}

export type SessionRegistry<Entry extends { session: McpSession }> = ReturnType<typeof createSessionRegistry<Entry>>;
