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
  pid: number | null;
  room: string;
  threadId: string | null;
  tmux: string | null;
}

export interface RunningSources {
  claude: ClaudeSession[];
  codexPids: Map<number, string>;
  codexThreads: CodexThread[];
  place: (cwd: string) => Promise<Place>;
  seats: KnownSeat[];
}

type Found = Omit<RunningAgent, 'branch' | 'repo' | 'room' | 'seats' | 'tmux'>;

// A pid is the surest match, so a seat that has one never falls back to the folder.
function holds(seat: KnownSeat, agent: Found) {
  if (seat.pid !== null) return seat.pid === agent.pid;
  if (seat.threadId) return agent.reach === 'codex_thread' && seat.threadId === agent.id;
  return seat.kind === agent.kind && seat.cwd === agent.cwd;
}

function seatsOf(seats: KnownSeat[], agent: Found) {
  const held = seats.filter(seat => holds(seat, agent));
  const unique = new Map(held.map(({ name, room }): [string, RunningSeat] => [`${room} ${name}`, { name, room }]));
  return {
    seats: [...unique.values()].sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name)),
    tmux: held.find(seat => seat.tmux)?.tmux ?? null,
  };
}

/** Joins the running sessions into one list with repo, branch, pid and the seats each one holds.
 * A plain codex in a folder that a shared server thread also has counts as that thread, and lends it its pid. */
export async function runningAgents({ claude, codexPids, codexThreads, place, seats }: RunningSources) {
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
      reach: 'claude_session',
      status,
    })),
    ...codexThreads.map(({ cwd, id, status }): Found => ({
      cwd,
      id,
      kind: 'codex',
      pid: tuiFor(cwd),
      reach: 'codex_thread',
      status,
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
      })),
  ];
  const cwds = [...new Set(found.map(agent => agent.cwd))];
  const places = new Map(await Promise.all(cwds.map(async cwd => [cwd, await place(cwd)] as const)));
  return found.map((agent): RunningAgent => {
    const held = seatsOf(seats, agent);
    return { ...agent, ...places.get(agent.cwd)!, room: held.seats[0]?.room ?? null, ...held };
  });
}
