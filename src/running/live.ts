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
  defaultBranch,
  gitPlace,
  lineage,
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

const NO_PIDS = new Map<number, string>();

// One ps for the whole scan: parents for the socket and pane walks, and pid with args for the codex tui parse.
async function readPs(run: Runner) {
  const out = (await run('ps', ['-axo', 'pid,ppid,args'])).stdout;
  return { parents: parentsFromPs(out), tuis: codexTuis(out.replace(/^(\s*\d+)\s+\d+/gm, '$1')) };
}

async function codexCwds(pids: number[], run: Runner) {
  if (pids.length === 0) return NO_PIDS;
  return cwdsFromLsof((await run('lsof', ['-a', '-b', '-w', '-d', 'cwd', '-Fn', '-p', pids.join(',')])).stdout);
}

/** The pid behind each client port of an MCP session's socket to the daemon on `port`. */
async function socketPids(port: number, run: Runner) {
  return peerPids({
    lsof: (await run('lsof', ['-b', '-w', '-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpn'])).stdout,
    port,
  });
}

interface SeatedPeer {
  kind: McpSession['kind'];
  ports: number[];
  seats: { name: string; room: string }[];
}

const socketPid = (ports: number[], pids: Map<number, number>) =>
  ports.map(found => pids.get(found)).find(found => found !== undefined);

/** The seats each seated MCP session holds, with the pid behind its socket and that pid's parents, since the
 * socket may sit in a helper under the session. A session whose socket lsof cannot place is left out. */
export function peerSeats({
  parents,
  peers,
  pids,
}: {
  parents: Map<number, number>;
  peers: SeatedPeer[];
  pids: Map<number, number>;
}) {
  return peers.flatMap(({ kind, ports, seats }): KnownSeat[] => {
    const pid = socketPid(ports, pids);
    if (pid === undefined) return [];
    const [, ...up] = lineage(pid, parents);
    return seats.map(({ name, room }) => ({
      cwd: null,
      kind,
      name,
      parents: up,
      pid,
      room,
      threadId: null,
      tmux: null,
    }));
  });
}

/** The mcp session of each running agent that messhall started: the nearest agent among the parents of the pid
 * behind its socket, as for a seat. */
export function channelSessions({
  agents,
  parents,
  peers,
  pids,
}: {
  agents: Set<number>;
  parents: Map<number, number>;
  peers: { id: string; ports: number[] }[];
  pids: Map<number, number>;
}) {
  return new Map(
    peers.flatMap(({ id, ports }): [number, string][] => {
      const pid = socketPid(ports, pids);
      const agent = pid === undefined ? undefined : lineage(pid, parents).find(found => agents.has(found));
      return agent === undefined ? [] : [[agent, id]];
    }),
  );
}

interface Scanned {
  agents: ScannedAgent[];
  suggestions: Running['suggestions'];
}

/** Builds the scan behind the human's running list: every claude and codex session on this Mac, with the
 * rooms it may want and where an invite to it goes. Reads session files, ps, lsof, tmux and git once each per
 * scan, never a transcript. A null `tmux` looks for no panes. */
export function createRunningScan({
  alive,
  claudeDir,
  codex,
  mcp,
  plainCodex: scanPlainCodex,
  port,
  run,
  seats,
  tmux,
}: {
  alive: (pid: number) => boolean;
  claudeDir: string;
  codex: Pick<CodexClient, 'request'>;
  mcp: { channelPeers: () => { id: string; ports: number[] }[]; peers: () => SeatedPeer[] };
  plainCodex: boolean;
  port: number;
  run: Runner;
  seats: () => Promise<KnownSeat[]>;
  tmux: Tmux | null;
}) {
  return async (): Promise<Scanned> => {
    const claude = readClaudeSessions({ alive, dir: claudeDir });
    const seated = mcp.peers();
    const open = mcp.channelPeers();
    const sockets = seated.length > 0 || open.length > 0;
    const [panes, pids] = await Promise.all([
      tmux && claude.length > 0
        ? tmux(['list-panes', '-a', '-F', '#{pane_pid} #{pane_id}']).then(out => panesFromTmux(out.stdout))
        : NO_PIDS,
      sockets ? socketPids(port, run) : new Map<number, number>(),
    ]);
    const ps = scanPlainCodex || pids.size > 0 || panes.size > 0 ? await readPs(run) : null;
    const parents = ps?.parents ?? new Map<number, number>();
    const [codexPids, codexThreads, known] = await Promise.all([
      scanPlainCodex ? codexCwds(ps?.tuis.map(tui => tui.pid) ?? [], run) : NO_PIDS,
      readCodexThreads({ codex }),
      seats(),
    ]);
    const agentPids = new Set([...claude.map(session => session.pid), ...codexPids.keys()]);
    const onDefault = new Set<string>();
    const agents = await runningAgents({
      channels: channelSessions({ agents: agentPids, parents, peers: open, pids }),
      claude,
      codexPids,
      codexThreads,
      panes: new Map(
        claude.flatMap(({ pid }): [number, string][] => {
          const pane = paneOf({ agents: agentPids, panes, parents, pid });
          return pane ? [[pid, pane]] : [];
        }),
      ),
      place: async cwd => {
        const place = await gitPlace({ cwd, run });
        if (place.branch && place.branch === (await defaultBranch({ cwd, run }))) onDefault.add(cwd);
        return place;
      },
      seats: [...known, ...peerSeats({ parents, peers: seated, pids })],
    });
    return { agents, suggestions: suggestRooms({ agents, isDefault: agent => onDefault.has(agent.cwd) }) };
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
