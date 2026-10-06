import type { AgentKind } from '../../contracts/room.ts';

/**
 * What the daemon knows about one MCP session: the name it holds in each room, its agent kind,
 * when it was last seen, and how many HTTP requests it has open right now.
 */
export function createSession({ id, now }: { id: string; now: () => Date }) {
  const rooms = new Map<string, string>();
  const marks = new Map<string, number>();
  let kind: AgentKind = 'other';
  let lastSeen = now().getTime();
  let open = 0;
  let threadId: string | undefined;

  return {
    /** Holds `name` in `room` for this session. `mark` is the newest message id when it joined. */
    bind(binding: { kind: AgentKind; mark?: number; name: string; room: string; threadId?: string }) {
      if (!rooms.has(binding.room)) marks.set(binding.room, binding.mark ?? 0);
      rooms.set(binding.room, binding.name);
      ({ kind } = binding);
      // A codex thread id is only passed once thread/read has checked it.
      if (binding.threadId) ({ threadId } = binding);
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
    /** True when no request is open and none ended after `cutoff`. A held GET stream keeps it live. */
    idleSince(cutoff: number) {
      return open === 0 && lastSeen <= cutoff;
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
    /** Stamps a tool call. */
    seen() {
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
