import type { RunningAgent, RunningSeat } from '../../contracts/feed.ts';
import type { ClaudeSession, CodexThread } from './scan.js';

interface Place {
  branch: string | null;
  repo: string | null;
}

/** A seat the daemon knows: by the pid holding it, a codex seat's thread, or the folder a spawned seat runs in. */
export interface KnownSeat {
  cwd: string | null;
  kind: 'claude' | 'codex' | 'other';
  name: string;
  parents?: number[];
  pid: number | null;
  room: string;
  threadId: string | null;
  tmux: string | null;
}

export interface RunningSources {
  /** The mcp session of each claude pid that messhall started, so an invite can ring its channel. */
  channels: Map<number, string>;
  claude: ClaudeSession[];
  codexPids: Map<number, string>;
  codexThreads: CodexThread[];
  /** The tmux pane each claude pid runs in. */
  panes: Map<number, string>;
  place: (cwd: string) => Promise<Place>;
  seats: KnownSeat[];
}

/** A running agent with where its invite goes: the mcp session of a channel, the pane id of a tmux pane, else null. */
export type ScannedAgent = RunningAgent & { target: string | null };

type Found = Omit<ScannedAgent, 'branch' | 'repo' | 'room' | 'seats' | 'tmux'>;

// A channel ring never types into a pane the human may be using, so it wins over tmux.
function claudeReach({ channels, panes }: Pick<RunningSources, 'channels' | 'panes'>, pid: number) {
  const channel = channels.get(pid);
  if (channel) return { reach: 'claude_channel', target: channel } as const;
  const pane = panes.get(pid);
  if (pane) return { reach: 'tmux_pane', target: pane } as const;
  return { reach: 'copy_only', target: null } as const;
}

// A pid is the surest match, so a seat that has one never falls back to the folder. A seat's socket may sit in
// a helper under its session, so the nearest running agent among its parents holds it.
function holds(seat: KnownSeat, agent: Found, pids: Set<number>) {
  if (seat.pid !== null) return [seat.pid, ...(seat.parents ?? [])].find(pid => pids.has(pid)) === agent.pid;
  if (seat.threadId) return agent.reach === 'codex_thread' && seat.threadId === agent.id;
  return seat.kind === agent.kind && seat.cwd === agent.cwd;
}

function seatsOf(seats: KnownSeat[], agent: Found, pids: Set<number>) {
  const held = seats.filter(seat => holds(seat, agent, pids));
  const unique = new Map(held.map(({ name, room }): [string, RunningSeat] => [`${room} ${name}`, { name, room }]));
  return {
    seats: [...unique.values()].sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name)),
    tmux: held.find(seat => seat.tmux)?.tmux ?? null,
  };
}

/** Joins the running sessions into one list with repo, branch, pid and the seats each one holds.
 * A plain codex in a folder that a shared server thread also has counts as that thread, and lends it its pid. */
export async function runningAgents({
  channels,
  claude,
  codexPids,
  codexThreads,
  panes,
  place,
  seats,
}: RunningSources) {
  const threadCwds = new Set(codexThreads.map(thread => thread.cwd));
  // A thread and a tui pair up only when each is alone in its folder, so a pid is never lent to the wrong one.
  const tuiFor = (cwd: string) => {
    const tuis = [...codexPids].filter(([, tuiCwd]) => tuiCwd === cwd);
    const threads = codexThreads.filter(thread => thread.cwd === cwd);
    return tuis.length === 1 && threads.length === 1 ? tuis[0]![0] : null;
  };
  const found: Found[] = [
    ...claude.map(({ cwd, id, pid, status }): Found => ({
      cwd,
      id,
      kind: 'claude',
      pid,
      ...claudeReach({ channels, panes }, pid),
      status,
    })),
    ...codexThreads.map(({ cwd, id, status }): Found => ({
      cwd,
      id,
      kind: 'codex',
      pid: tuiFor(cwd),
      reach: 'codex_thread',
      status,
      target: null,
    })),
    ...[...codexPids]
      .filter(([, cwd]) => !threadCwds.has(cwd))
      .map(([pid, cwd]): Found => ({
        cwd,
        id: `pid-${pid}`,
        kind: 'codex',
        pid,
        reach: 'copy_only',
        status: 'unknown',
        target: null,
      })),
  ];
  const pids = new Set(found.flatMap(agent => (agent.pid === null ? [] : [agent.pid])));
  const cwds = [...new Set(found.map(agent => agent.cwd))];
  const places = new Map(await Promise.all(cwds.map(async cwd => [cwd, await place(cwd)] as const)));
  return found.map((agent): ScannedAgent => {
    const held = seatsOf(seats, agent, pids);
    return { ...agent, ...places.get(agent.cwd)!, room: held.seats[0]?.room ?? null, ...held };
  });
}
