import type { RunResult } from '../lib/run.js';
import type { Command } from 'commander';

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { NAME_PATTERN, RESERVED_NAMES } from '../../../contracts/room.ts';
import { daemonUrl, dataDir as defaultDataDir, DB_FILE } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { shellLine } from '../../../src/lib/shell.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { launchClaude, tmux as runTmux, typePrompt, writeMcpConfig } from '../lib/claudeTmux.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { reviewQueue } from '../lib/review.js';
import { run } from '../lib/run.js';
import {
  branchSlug,
  parseFlock,
  parseQueueRow,
  seatPrompt,
  seatSessionName,
  sessionName,
  spawnArgv,
  spawnPlan,
  spawnPrompt,
} from '../lib/spawn.js';

const SKILL_SCRIPTS = path.join(REPO_ROOT, '.claude/skills/messhall-pickup-any-work/scripts');
const DEFAULT_ROOM = 'dev';
const DEFAULT_MODEL = 'opus';
const ROW_ID = /^[a-z]\d+$/i;
const REVIEW_LOOKBACK = 500;
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
  const checkout = await mainCheckout();
  const argv = spawnArgv({ debugFile, mainCheckout: checkout, mcpConfig, model });
  const owner = `agent ${stamp(now())} ${row.branch}`;
  const worktreeRel = `.worktrees/${slug}`;
  const plannedWorktree = path.join(checkout, worktreeRel);
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

/** Starts a seated claude with no queue row in tmux session `messhall-seat-<name>`, in the main checkout.
 * It joins as `name` and waits for the orchestrator or the human to give it a role. */
export async function seatRun({
  dataDir,
  dryRun,
  launch = launchClaude,
  model,
  name,
  room,
  url,
}: {
  dataDir: string;
  dryRun: boolean;
  launch?: typeof launchClaude;
  model: string;
  name: string;
  room: string;
  url: string;
}) {
  if (!NAME_PATTERN.test(name) || (RESERVED_NAMES as readonly string[]).includes(name)) {
    return { code: 1, report: bad(`not spawning: ${name} is not a free member name (a-z, 0-9, dashes, up to 40)`) };
  }
  const session = seatSessionName(name);
  const debugFile = path.join(dataDir, 'spawn', `seat-${name}-debug.log`);
  const mcpConfig = path.join(dataDir, 'spawn', `seat-${name}-mcp.json`);
  const cwd = await mainCheckout();
  const argv = spawnArgv({ debugFile, mainCheckout: cwd, mcpConfig, model });
  const prompt = seatPrompt({ name, room });
  if (dryRun) {
    return {
      code: 0,
      report: [
        dim('dry run, nothing started. would run:'),
        dim(`tmux session ${session}: cd ${cwd} && ${shellLine(argv)}`),
        dim(`prompt: ${prompt}`),
        ok(`${name} is ready to seat in #${room}`),
      ].join('\n'),
    };
  }
  const keyFile = path.join(dataDir, KEY_FILES.agent);
  if (!existsSync(keyFile)) return { code: 1, report: bad(`no agent key at ${keyFile}. start the daemon once`) };
  mkdirSync(path.dirname(debugFile), { recursive: true });
  rmSync(debugFile, { force: true });
  writeMcpConfig({ file: mcpConfig, key: readFileSync(keyFile, 'utf8').trim(), url });
  const ready = await launch({ argv, cwd, debugFile, note: line => console.error(dim(line)), session });
  if (ready !== 'registered') {
    await runTmux(['kill-session', '-t', session]);
    return { code: 1, report: bad(`claude did not come up (${ready})`) };
  }
  await typePrompt(session, prompt);
  return {
    code: 0,
    report: [
      ok(`claude on ${model} in tmux session ${session}, prompt typed`),
      dim(`it joins #${room} as ${name} and waits for a role. watch: tmux attach -t ${session}`),
    ].join('\n'),
  };
}

function withStore<T>({ dataDir }: { dataDir: string }, use: (store: ReturnType<typeof createRoomStore>) => T) {
  if (!existsSync(path.join(dataDir, DB_FILE))) return;
  const db = openDb({ dataDir });
  try {
    return use(createRoomStore({ db, now: () => new Date() }));
  } finally {
    db.close();
  }
}

// Members still seated in the room, by name, so flock can show each one's role.
const seatedMembers = ({ dataDir, room }: { dataDir: string; room: string }) =>
  withStore({ dataDir }, store => {
    const members = store.listMembers(room).filter(member => member.presence !== 'gone');
    return new Map(members.map(member => [member.name, member]));
  });

/** Spawned rows and seats from tmux: row and branch from the queue, whether the agent sits in `room`, and its role. */
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
  const seated = seatedMembers({ dataDir, room });
  const rows = panes.map(entry => {
    const branch = entry.kind === 'row' ? (parseQueueRow({ id: entry.row, listing })?.branch ?? '') : '';
    const name = entry.kind === 'seat' ? entry.name : branch && branchSlug(branch);
    const member = name ? seated?.get(name) : undefined;
    return [
      entry.session,
      entry.pane,
      entry.kind === 'row' ? entry.row : '-',
      entry.kind === 'row' ? branch || '?' : '-',
      String(entry.pid),
      member ? ok(`#${room} as ${member.name}`) : seated ? bad('not seated') : dim('no db'),
      member?.role ?? '',
    ];
  });
  return { code: 0, report: formatTable(['session', 'pane', 'row', 'branch', 'pid', 'seat', 'role'], rows) };
}

/** Kills a row's spawn session, or a seat's by name. A row stays claimed, so the reply says how to hand it back. */
export async function flockStop({ target, tmux = runTmux }: { target: string; tmux?: Runner }) {
  const isRow = ROW_ID.test(target);
  const session = isRow ? sessionName(target.toUpperCase()) : seatSessionName(target);
  const killed = await tmux(['kill-session', '-t', session]);
  if (killed.code !== 0) return { code: 1, report: bad(`no spawned session ${session}`) };
  const hint = isRow
    ? [dim(`the row is still claimed. hand it back with queue.py release ${target.toUpperCase()}`)]
    : [];
  return { code: 0, report: [ok(`stopped ${session}`), ...hint].join('\n') };
}

/** Open review requests in `room`: the latest round per PR, who asked, who is named, and answered, waiting or stale. */
export function reviewsReport({ dataDir, now = new Date(), room }: { dataDir: string; now?: Date; room: string }) {
  const listed = withStore({ dataDir }, store => store.listMessages({ limit: REVIEW_LOOKBACK, room }));
  if (!listed?.ok) return { code: 1, report: bad(`no room #${room} in ${dataDir}`) };
  const queue = reviewQueue({ messages: listed.messages, now });
  if (!queue.length) return { code: 0, report: dim(`no review requests in #${room}`) };
  const paint = { answered: dim, stale: bad, waiting: ok } as const;
  return {
    code: 0,
    report: formatTable(
      ['id', 'from', 'url', 'round', 'reviewer', 'age', 'state'],
      queue.map(item => [
        String(item.id),
        item.from,
        item.url,
        String(item.round),
        item.reviewer,
        `${item.ageMin}m`,
        paint[item.state](item.state),
      ]),
    ),
  };
}

/** Registers `spawn <row|agent>`, `flock [stop <row|name>]` and `reviews`. */
export function registerSpawn(program: Command) {
  program
    .command('spawn <row>')
    .description(
      'Claim a ready queue row and start a seated Claude Code on it in tmux, or with `agent --as <name>` seat one with no row. Both wait for a role.',
    )
    .option('--room <room>', 'room the agent sits in', DEFAULT_ROOM)
    .option('--model <model>', 'claude model', DEFAULT_MODEL)
    .option('--brief <file>', 'brief a row agent reads first, else it runs the pickup skill')
    .option('--as <name>', 'with `agent`: the member name to seat')
    .option('--dry-run', 'print the plan, claim and start nothing')
    .action(
      async (
        row: string,
        options: {
          as?: string;
          brief?: string;
          dryRun?: boolean;
          model: string;
          room: string;
        },
      ) => {
        const shared = { dataDir: defaultDataDir(), dryRun: Boolean(options.dryRun), url: daemonUrl() };
        const result =
          row === 'agent'
            ? options.as
              ? await seatRun({ ...shared, ...options, name: options.as })
              : { code: 1, report: bad('spawn agent needs --as <name>') }
            : await spawnRun({ ...shared, ...options, id: row.toUpperCase() });
        console.log(result.report);
        process.exitCode = result.code;
      },
    );

  const flock = program
    .command('flock')
    .description('List spawned rows and seats with tmux pane, row, branch, pid, seat and role.')
    .option('--room <room>', 'room to check seats in', DEFAULT_ROOM)
    .action(async (options: { room: string }) => {
      const result = await flockRun({ dataDir: defaultDataDir(), room: options.room });
      console.log(result.report);
      process.exitCode = result.code;
    });
  flock
    .command('stop <target>')
    .description("Kill a row's spawned session, or a seat's by name.")
    .action(async (target: string) => {
      const result = await flockStop({ target });
      console.log(result.report);
      process.exitCode = result.code;
    });

  program
    .command('reviews')
    .description(
      'Review requests in a room: latest round per PR, the named reviewer, and answered, waiting or stale (10 min).',
    )
    .option('--room <room>', 'room to read', DEFAULT_ROOM)
    .action((options: { room: string }) => {
      const result = reviewsReport({ dataDir: defaultDataDir(), room: options.room });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
