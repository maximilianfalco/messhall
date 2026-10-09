import type { Running, RunningInvite, RunningInviteResult } from '../../contracts/feed.ts';
import type { CodexClient } from '../codex/client.js';
import type { Runner } from '../lib/run.js';
import type { McpSession } from '../mcp/session.js';
import type { KnownSeat } from './running.js';

import { queueText } from '../codex/client.js';
import { codexTuis } from '../codex/tuis.js';

import { inviteRunning } from './invite.js';
import { runningAgents } from './running.js';
import { cwdsFromLsof, gitPlace, peerPids, readClaudeSessions, readCodexThreads } from './scan.js';
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

/** The seats each seated MCP session holds, with the pid on the other end of its open socket to the daemon.
 * A session whose socket lsof cannot place is left out. */
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
  const pids = peerPids({
    lsof: (await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpn'])).stdout,
    port,
  });
  return seated.flatMap(({ kind, ports, seats }): KnownSeat[] => {
    const pid = ports.map(found => pids.get(found)).find(found => found !== undefined);
    if (pid === undefined) return [];
    return seats.map(({ name, room }) => ({ cwd: null, kind, name, pid, room, threadId: null, tmux: null }));
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
    const agents = await runningAgents({
      claude: readClaudeSessions({ alive, dir: claudeDir }),
      codexPids,
      codexThreads,
      place: cwd => gitPlace({ cwd, run }),
      seats: known,
    });
    return { agents, suggestions: suggestRooms({ agents }) };
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
