import type { RunResult } from '../lib/run.js';
import type { Command } from 'commander';

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir as defaultDataDir, DB_FILE } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { shellLine } from '../../../src/lib/shell.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { launchClaude, tmux as runTmux, typePrompt, writeMcpConfig } from '../lib/claudeTmux.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { run } from '../lib/run.js';
import { branchSlug, parseFlock, parseQueueRow, sessionName, spawnArgv, spawnPlan, spawnPrompt } from '../lib/spawn.js';

const SKILL_SCRIPTS = path.join(REPO_ROOT, '.claude/skills/messhall-pickup-any-work/scripts');
const DEFAULT_ROOM = 'dev';
const DEFAULT_MODEL = 'opus';
const FLOCK_FORMAT = '#{session_name}\t#{pane_id}\t#{pane_pid}';

export type Runner = (args: string[]) => Promise<RunResult>;

const runQueue: Runner = args => run('python3', [path.join(SKILL_SCRIPTS, 'queue.py'), ...args], REPO_ROOT);
const lastLine = (text: string) => text.trim().split('\n').at(-1) ?? '';
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;

async function mainCheckout() {
  const listed = await run('git', ['worktree', 'list', '--porcelain'], REPO_ROOT);
  return listed.stdout.split('\n')[0]?.replace(/^worktree /, '') || REPO_ROOT;
}

interface SpawnOptions {
  brief?: string;
  dataDir: string;
  dryRun: boolean;
  id: string;
  launch?: typeof launchClaude;
  model: string;
  now?: () => Date;
  queue?: Runner;
  room: string;
  url: string;
}

/** Claims a ready row, makes its worktree and starts a seated claude in tmux session `messhall-<row>`.
 * If claude never comes up, the row goes back to open so nobody waits on it. */
export async function spawnRun({
  brief,
  dataDir,
  dryRun,
  id,
  launch = launchClaude,
  model,
  now = () => new Date(),
  queue = runQueue,
  room,
  url,
}: SpawnOptions) {
  const plan = spawnPlan({ id, listing: (await queue(['show', '--all'])).stdout });
  if (!plan.ok) return { code: 1, report: bad(`not spawning: ${plan.reason}`) };
  const { row, session, slug } = plan;
  const briefFile = brief && path.resolve(brief);
  if (briefFile && !existsSync(briefFile)) return { code: 1, report: bad(`no brief at ${briefFile}`) };

  const spawnDir = path.join(dataDir, 'spawn');
  const debugFile = path.join(spawnDir, `${row.id}-debug.log`);
  const mcpConfig = path.join(spawnDir, `${row.id}-mcp.json`);
  const argv = spawnArgv({ debugFile, mcpConfig, model });
  const owner = `agent ${stamp(now())} ${row.branch}`;
  const worktreeRel = `.worktrees/${slug}`;
  const plannedWorktree = path.join(await mainCheckout(), worktreeRel);
  const prompt = (worktree: string) =>
    spawnPrompt({ branch: row.branch, brief: briefFile, id: row.id, room, worktree });

  if (dryRun) {
    return {
      code: 0,
      report: [
        dim('dry run, nothing claimed or started. would run:'),
        dim(`claim ${row.id} as "${owner}" in ${worktreeRel}`),
        dim(`worktree ${plannedWorktree} on ${row.branch}`),
        dim(`tmux session ${session}: cd ${plannedWorktree} && ${shellLine(argv)}`),
        dim(`prompt: ${prompt(plannedWorktree)}`),
        ok(`${row.id} is ready to spawn as ${slug} in #${room}`),
      ].join('\n'),
    };
  }

  const keyFile = path.join(dataDir, KEY_FILES.agent);
  if (!existsSync(keyFile)) return { code: 1, report: bad(`no agent key at ${keyFile}. start the daemon once`) };
  const claimed = await queue(['claim', row.id, owner, worktreeRel]);
  if (claimed.code !== 0) return { code: 1, report: bad(`claim refused: ${claimed.stderr.trim()}`) };

  const lines = [ok(`claimed ${row.id} as ${owner}`)];
  const note = (line: string) => console.error(dim(line));
  const giveBack = async (why: string) => {
    await queue(['release', row.id]);
    return { code: 1, report: [...lines, bad(why), dim(`released ${row.id}`)].join('\n') };
  };
  const made = await run('bash', [path.join(SKILL_SCRIPTS, 'worktree.sh'), row.branch], REPO_ROOT);
  const worktree = lastLine(made.stdout);
  if (made.code !== 0 || !existsSync(worktree)) return giveBack(`worktree failed: ${made.stderr.trim()}`);
  lines.push(ok(`worktree ${worktree}`));

  mkdirSync(spawnDir, { recursive: true });
  rmSync(debugFile, { force: true });
  writeMcpConfig({ file: mcpConfig, key: readFileSync(keyFile, 'utf8').trim(), url });
  const ready = await launch({ argv, cwd: worktree, debugFile, note, session });
  if (ready !== 'registered') {
    await runTmux(['kill-session', '-t', session]);
    return giveBack(`claude did not come up (${ready})`);
  }
  await typePrompt(session, prompt(worktree));
  lines.push(
    ok(`claude on ${model} in tmux session ${session}, prompt typed`),
    dim(`it joins #${room} as ${slug}. watch: tmux attach -t ${session}, list: pnpm messhall-dev flock`),
  );
  return { code: 0, report: lines.join('\n') };
}

function seatedNames({ dataDir, room }: { dataDir: string; room: string }) {
  if (!existsSync(path.join(dataDir, DB_FILE))) return;
  const db = openDb({ dataDir });
  try {
    const members = createRoomStore({ db, now: () => new Date() }).listMembers(room);
    return new Set(members.filter(member => member.presence !== 'gone').map(member => member.name));
  } finally {
    db.close();
  }
}

/** Spawned sessions from tmux, each with its row and branch from the queue and whether its slug sits in `room`. */
export async function flockRun({
  dataDir,
  queue = runQueue,
  room,
  tmux = runTmux,
}: {
  dataDir: string;
  queue?: Runner;
  room: string;
  tmux?: Runner;
}) {
  const panes = parseFlock((await tmux(['list-panes', '-a', '-F', FLOCK_FORMAT])).stdout);
  if (!panes.length) return { code: 0, report: dim('no spawned sessions') };
  const listing = (await queue(['show', '--all'])).stdout;
  const seated = seatedNames({ dataDir, room });
  const rows = panes.map(entry => {
    const branch = parseQueueRow({ id: entry.row, listing })?.branch ?? '';
    const sitting = branch && seated?.has(branchSlug(branch));
    return [
      entry.session,
      entry.pane,
      entry.row,
      branch || '?',
      String(entry.pid),
      sitting ? ok(`#${room}`) : seated ? bad('not seated') : dim('no db'),
    ];
  });
  return { code: 0, report: formatTable(['session', 'pane', 'row', 'branch', 'pid', 'seat'], rows) };
}

/** Kills a row's spawn session. The row stays claimed, so the reply says how to hand it back. */
export async function flockStop({ row, tmux = runTmux }: { row: string; tmux?: Runner }) {
  const session = sessionName(row);
  const killed = await tmux(['kill-session', '-t', session]);
  if (killed.code !== 0) return { code: 1, report: bad(`no spawned session ${session}`) };
  return {
    code: 0,
    report: [ok(`stopped ${session}`), dim(`the row is still claimed. hand it back with queue.py release ${row}`)].join(
      '\n',
    ),
  };
}

/** Registers `spawn <row> [--room dev] [--model opus] [--brief <file>] [--dry-run]` and `flock [stop <row>]`. */
export function registerSpawn(program: Command) {
  program
    .command('spawn <row>')
    .description(
      'Claim a ready queue row, make its worktree and start a seated Claude Code on it in tmux, in the real room.',
    )
    .option('--room <room>', 'room the agent sits in while it works', DEFAULT_ROOM)
    .option('--model <model>', 'claude model', DEFAULT_MODEL)
    .option('--brief <file>', 'brief the agent reads first, else it runs the pickup skill')
    .option('--dry-run', 'print the plan, claim and start nothing')
    .action(async (row: string, options: { brief?: string; dryRun?: boolean; model: string; room: string }) => {
      const result = await spawnRun({
        ...options,
        dataDir: defaultDataDir(),
        dryRun: Boolean(options.dryRun),
        id: row.toUpperCase(),
        url: daemonUrl(),
      });
      console.log(result.report);
      process.exitCode = result.code;
    });

  const flock = program
    .command('flock')
    .description('List spawned sessions with tmux pane, row, branch, pid and whether the agent is seated.')
    .option('--room <room>', 'room to check seats in', DEFAULT_ROOM)
    .action(async (options: { room: string }) => {
      const result = await flockRun({ dataDir: defaultDataDir(), room: options.room });
      console.log(result.report);
      process.exitCode = result.code;
    });
  flock
    .command('stop <row>')
    .description("Kill a row's spawned session.")
    .action(async (row: string) => {
      const result = await flockStop({ row: row.toUpperCase() });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
