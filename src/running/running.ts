import type { ClaudeSession, CodexThread } from './scan.js';
import type { RunningAgent } from '../../contracts/feed.ts';

interface Place {
  branch: string | null;
  repo: string | null;
}

/** A seat the daemon knows: a codex seat's thread, or the folder a spawned seat runs in. */
export interface KnownSeat {
  cwd: string | null;
  kind: 'claude' | 'codex' | 'other';
  room: string;
  threadId: string | null;
}

export interface RunningSources {
  claude: ClaudeSession[];
  codexPids: Map<number, string>;
  codexThreads: CodexThread[];
  place: (cwd: string) => Promise<Place>;
  seats: KnownSeat[];
}

type Found = Omit<RunningAgent, 'branch' | 'repo'>;

/** Joins the running sessions into one list with repo, branch and the room each one already sits in.
 * A plain codex in a folder that a shared server thread also has counts as that thread. */
export async function runningAgents({ claude, codexPids, codexThreads, place, seats }: RunningSources) {
  const roomOf = ({ cwd, kind, threadId }: { cwd: string; kind: 'claude' | 'codex'; threadId?: string }) =>
    seats.find(seat => (threadId ? seat.threadId === threadId : seat.kind === kind && seat.cwd === cwd))?.room ??
    null;
  const threadCwds = new Set(codexThreads.map(thread => thread.cwd));
  const found: Found[] = [
    ...claude.map(({ cwd, id, status }): Found => ({
      cwd,
      id,
      kind: 'claude',
      reach: 'claude_session',
      room: roomOf({ cwd, kind: 'claude' }),
      status,
    })),
    ...codexThreads.map(({ cwd, id, status }): Found => ({
      cwd,
      id,
      kind: 'codex',
      reach: 'codex_thread',
      room: roomOf({ cwd, kind: 'codex', threadId: id }),
      status,
    })),
    ...[...codexPids]
      .filter(([, cwd]) => !threadCwds.has(cwd))
      .map(([pid, cwd]): Found => ({
        cwd,
        id: `pid-${pid}`,
        kind: 'codex',
        reach: 'copy_only',
        room: roomOf({ cwd, kind: 'codex' }),
        status: 'unknown',
      })),
  ];
  const cwds = [...new Set(found.map(agent => agent.cwd))];
  const places = new Map(await Promise.all(cwds.map(async cwd => [cwd, await place(cwd)] as const)));
  return found.map((agent): RunningAgent => ({ ...agent, ...places.get(agent.cwd)! }));
}
