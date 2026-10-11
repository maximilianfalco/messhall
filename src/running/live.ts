import type { Running, RunningInvite, RunningInviteResult } from '../../contracts/feed.ts';
import type { CodexClient } from '../codex/client.js';
import type { Tmux } from '../flock/tmux.js';
import type { Runner } from '../lib/run.js';
import type { McpSession } from '../mcp/session.js';
import type { Deliver } from './invite.js';
import type { KnownSeat, ScannedAgent } from './running.js';

import { queueText } from '../codex/client.js';
import { codexTuis } from '../codex/tuis.js';

import { inviteRunning } from './invite.js';
import { runningAgents } from './running.js';
import {
  cwdsFromLsof,
  gitPlace,
  paneOf,
  panesFromTmux,
  parentsFromPs,
  peerPids,
  readClaudeSessions,
  readCodexThreads,
} from './scan.js';
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

/** The tmux pane each pid runs in, found by walking up its parents to a pane's own process. */
async function tmuxPanes({ pids, run, tmux }: { pids: number[]; run: Runner; tmux: Tmux }) {
  if (pids.length === 0) return new Map<number, string>();
  const panes = panesFromTmux((await tmux(['list-panes', '-a', '-F', '#{pane_pid} #{pane_id}'])).stdout);
  if (panes.size === 0) return new Map<number, string>();
  const parents = parentsFromPs((await run('ps', ['-axo', 'pid=,ppid='])).stdout);
  return new Map(
    pids.flatMap((pid): [number, string][] => {
      const pane = paneOf({ panes, parents, pid });
      return pane ? [[pid, pane]] : [];
    }),
  );
}

const lsofPeers = (port: number, run: Runner) =>
  run('lsof', ['-b', '-w', '-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpn']);

/** The mcp session each claude pid that messhall started holds open, by the pid on the other end of its socket. */
export async function channelSessions({
  peers,
  port,
  run,
}: {
  peers: () => { id: string; ports: number[] }[];
  port: number;
  run: Runner;
}) {
  const open = peers();
  if (open.length === 0) return new Map<number, string>();
  const pids = peerPids({ lsof: (await lsofPeers(port, run)).stdout, port });
  return new Map(
    open.flatMap(({ id, ports }): [number, string][] => {
      const pid = ports.map(found => pids.get(found)).find(found => found !== undefined);
      return pid === undefined ? [] : [[pid, id]];
    }),
  );
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
  const pids = peerPids({ lsof: (await lsofPeers(port, run)).stdout, port });
  return seated.flatMap(({ kind, ports, seats }): KnownSeat[] => {
    const pid = ports.map(found => pids.get(found)).find(found => found !== undefined);
    if (pid === undefined) return [];
    return seats.map(({ name, room }) => ({ cwd: null, kind, name, pid, room, threadId: null, tmux: null }));
  });
}

interface Scanned {
  agents: ScannedAgent[];
  suggestions: Running['suggestions'];
}

/** Builds the scan behind the human's running list: every claude and codex session on this Mac, with the
 * rooms it may want and where an invite to it goes. Reads session files, ps, lsof, tmux and git, never a
 * transcript. A null `tmux` looks for no panes. */
export function createRunningScan({
  alive,
  channels,
  claudeDir,
  codex,
  plainCodex: scanPlainCodex,
  run,
  seats,
  tmux,
}: {
  alive: (pid: number) => boolean;
  channels: () => Promise<Map<number, string>>;
  claudeDir: string;
  codex: Pick<CodexClient, 'request'>;
  plainCodex: boolean;
  run: Runner;
  seats: () => Promise<KnownSeat[]>;
  tmux: Tmux | null;
}) {
  return async (): Promise<Scanned> => {
    const claude = readClaudeSessions({ alive, dir: claudeDir });
    const pids = claude.map(session => session.pid);
    const [codexPids, codexThreads, known, open, panes] = await Promise.all([
      scanPlainCodex ? plainCodex(run) : new Map<number, string>(),
      readCodexThreads({ codex }),
      seats(),
      channels(),
      tmux ? tmuxPanes({ pids, run, tmux }) : new Map<number, string>(),
    ]);
    const agents = await runningAgents({
      channels: open,
      claude,
      codexPids,
      codexThreads,
      panes,
      place: cwd => gitPlace({ cwd, run }),
      seats: known,
    });
    return { agents, suggestions: suggestRooms({ agents }) };
  };
}

/** The running list as the human sees it, without the session or pane each invite goes to. */
export const shownRunning = ({ agents, suggestions }: Scanned): Running => ({
  agents: agents.map(({ target: _target, ...agent }) => agent),
  suggestions,
});

/** Builds the human's invite: scans again so only agents still running get a line, and sends it on its own
 * where it can: a claude channel ring, keys in an idle claude's tmux pane, or a queue on a shared codex thread. */
export function createRunningInvite({
  codex,
  ring,
  scan,
  type,
}: Omit<Deliver, 'queue'> & {
  codex: Pick<CodexClient, 'request'>;
  scan: () => Promise<Scanned>;
}) {
  const queue = async (threadId: string, text: string) => (await queueText(codex, { text, threadId })).ok;
  return async ({ ids, room }: RunningInvite): Promise<RunningInviteResult> => ({
    invites: await inviteRunning({ agents: (await scan()).agents, deliver: { queue, ring, type }, ids, room }),
  });
}
