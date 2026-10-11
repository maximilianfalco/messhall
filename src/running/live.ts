import type { Running, RunningInvite, RunningInviteResult } from '../../contracts/feed.ts';
import type { CodexClient } from '../codex/client.js';
import type { Runner } from '../lib/run.js';
import type { McpSession } from '../mcp/session.js';
import type { KnownSeat } from './running.js';

import { queueText } from '../codex/client.js';
import { codexTuis } from '../codex/tuis.js';

import { inviteRunning } from './invite.js';
import { runningAgents } from './running.js';
import { cwdsFromLsof, defaultBranch, gitPlace, peerPids, readClaudeSessions, readCodexThreads } from './scan.js';
import { suggestRooms } from './suggest.js';

/** True when `pid` still runs. A process of another user still counts. */
export function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function plainCodex(run: Runner) {
  const pids = codexTuis((await run('ps', ['-axo', 'pid,args'])).stdout).map(tui => tui.pid);
  if (pids.length === 0) return new Map<number, string>();
  return cwdsFromLsof((await run('lsof', ['-a', '-b', '-w', '-d', 'cwd', '-Fn', '-p', pids.join(',')])).stdout);
}

function parentPids(ps: string) {
  const parents = new Map<number, number>();
  for (const line of ps.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid) parents.set(pid, ppid);
  }
  return parents;
}

// The socket may belong to a helper under the session, so the session is one of its parents.
function ancestors(pid: number, parents: Map<number, number>) {
  const chain: number[] = [];
  for (
    let next = parents.get(pid);
    next && next > 1 && chain.length < 8 && next !== pid && !chain.includes(next);
    next = parents.get(next)
  ) {
    chain.push(next);
  }
  return chain;
}

/** The seats each seated MCP session holds, with the pid on the other end of its open socket to the daemon and
 * that pid's parents, since the socket may sit in a helper under the session. A session whose socket lsof cannot
 * place is left out. */
export async function peerSeats({
  peers,
  port,
  run,
}: {
  peers: () => { kind: McpSession['kind']; ports: number[]; seats: { name: string; room: string }[] }[];
  port: number;
  run: Runner;
}) {
  const seated = peers();
  if (seated.length === 0) return [];
  const [lsof, ps] = await Promise.all([
    run('lsof', ['-b', '-w', '-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpn']),
    run('ps', ['-axo', 'pid,ppid']),
  ]);
  const pids = peerPids({ lsof: lsof.stdout, port });
  const parents = parentPids(ps.stdout);
  return seated.flatMap(({ kind, ports, seats }): KnownSeat[] => {
    const pid = ports.map(found => pids.get(found)).find(found => found !== undefined);
    if (pid === undefined) return [];
    return seats.map(({ name, room }) => ({
      cwd: null,
      kind,
      name,
      parents: ancestors(pid, parents),
      pid,
      room,
      threadId: null,
      tmux: null,
    }));
  });
}

/** Builds the scan behind the human's running list: every claude and codex session on this Mac, with the
 * rooms it may want. Reads session files, ps, lsof and git, never a transcript. */
export function createRunningScan({
  alive,
  claudeDir,
  codex,
  plainCodex: scanPlainCodex,
  run,
  seats,
}: {
  alive: (pid: number) => boolean;
  claudeDir: string;
  codex: Pick<CodexClient, 'request'>;
  plainCodex: boolean;
  run: Runner;
  seats: () => Promise<KnownSeat[]>;
}) {
  return async (): Promise<Running> => {
    const [codexPids, codexThreads, known] = await Promise.all([
      scanPlainCodex ? plainCodex(run) : new Map<number, string>(),
      readCodexThreads({ codex }),
      seats(),
    ]);
    const onDefault = new Set<string>();
    const agents = await runningAgents({
      claude: readClaudeSessions({ alive, dir: claudeDir }),
      codexPids,
      codexThreads,
      place: async cwd => {
        const place = await gitPlace({ cwd, run });
        if (place.branch && place.branch === (await defaultBranch({ cwd, run }))) onDefault.add(cwd);
        return place;
      },
      seats: known,
    });
    return { agents, suggestions: suggestRooms({ agents, isDefault: agent => onDefault.has(agent.cwd) }) };
  };
}

/** Builds the human's invite: scans again so only agents still running get a line, and queues it on each
 * shared codex thread the way the doorbell rings one. */
export function createRunningInvite({
  codex,
  scan,
}: {
  codex: Pick<CodexClient, 'request'>;
  scan: () => Promise<Running>;
}) {
  const queue = async (threadId: string, text: string) => (await queueText(codex, { text, threadId })).ok;
  return async ({ ids, room }: RunningInvite): Promise<RunningInviteResult> => ({
    invites: await inviteRunning({ agents: (await scan()).agents, ids, queue, room }),
  });
}
