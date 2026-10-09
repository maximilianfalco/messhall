import type { RunResult } from '../lib/run.js';
import type { Command } from 'commander';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { INSTRUCTIONS_MAX_CHARS, NAME_PATTERN, RESERVED_NAMES, UNASSIGNED_ROLE } from '../../../contracts/room.ts';
import { runFlock, runFlockStop, seatedLines, spawnSeat } from '../../../src/cli/spawn.js';
import { daemonUrl, dataDir as defaultDataDir, DB_FILE } from '../../../src/config.js';
import { typePrompt, untypedLine } from '../../../src/flock/tmux.js';
import { openDb } from '../../../src/rooms/db.js';
import { reviewQueue } from '../../../src/rooms/reviews.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { tmux as runTmux } from '../lib/claudeTmux.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { run } from '../lib/run.js';
import { branchSlug, DEFAULT_REVIEWER, parseQueueRow, rowInstructions, spawnPlan } from '../lib/spawn.js';

type Daemon = Parameters<typeof runFlock>[0];

const SKILL_SCRIPTS = path.join(REPO_ROOT, '.claude/skills/messhall-pickup-any-work/scripts');
const DEFAULT_ROOM = 'dev';
const DEFAULT_MODEL = 'opus';
const ROW_ID = /^[a-z]\d+$/i;
const REVIEW_LOOKBACK = 500;

export type Runner = (args: string[]) => Promise<RunResult>;

const runQueue: Runner = args => run('python3', [path.join(SKILL_SCRIPTS, 'queue.py'), ...args], REPO_ROOT);
const lastLine = (text: string) => text.trim().split('\n').at(-1) ?? '';
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;

/** The main checkout, the first worktree git lists, from any worktree. */
export async function mainCheckout() {
  const listed = await run('git', ['worktree', 'list', '--porcelain'], REPO_ROOT);
  return listed.stdout.split('\n')[0]?.replace(/^worktree /, '') || REPO_ROOT;
}

async function makeWorktree(branch: string) {
  const made = await run('bash', [path.join(SKILL_SCRIPTS, 'worktree.sh'), branch], REPO_ROOT);
  const worktree = lastLine(made.stdout);
  return made.code === 0 && existsSync(worktree)
    ? ({ ok: true, path: worktree } as const)
    : ({ error: `worktree failed: ${made.stderr.trim()}`, ok: false } as const);
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

export type Worktree = typeof makeWorktree;

interface SpawnOptions {
  assign?: string;
  brief?: string;
  daemon: Daemon;
  dryRun: boolean;
  id: string;
  instructions?: string;
  model: string;
  now?: () => Date;
  queue?: Runner;
  reviewer?: string;
  room: string;
  worktree?: Worktree;
}

const planLine = ({
  cwd,
  model,
  name,
  role,
  room,
}: {
  cwd: string;
  model: string;
  name: string;
  role: string;
  room: string;
}) => `spawn ${name} as ${role} in #${room} on ${model} in ${cwd}`;

/** Claims a ready row, makes its worktree and seats a claude there through the product spawner, named after the branch.
 * The row reaches the agent in its role instructions. If the spawn fails, the row goes back to open so nobody waits on it. */
export async function spawnRun({
  assign = UNASSIGNED_ROLE,
  brief,
  daemon,
  dryRun,
  id,
  instructions,
  model,
  now = () => new Date(),
  queue = runQueue,
  reviewer,
  room,
  worktree = makeWorktree,
}: SpawnOptions) {
  const plan = spawnPlan({ id, listing: (await queue(['show', '--all'])).stdout });
  if (!plan.ok) return { code: 1, report: bad(`not spawning: ${plan.reason}`) };
  const { row, slug } = plan;
  const briefFile = brief && path.resolve(brief);
  if (briefFile && !existsSync(briefFile)) return { code: 1, report: bad(`no brief at ${briefFile}`) };
  const roleFileIn = instructions && path.resolve(instructions);
  if (roleFileIn && !existsSync(roleFileIn)) return { code: 1, report: bad(`no instructions at ${roleFileIn}`) };
  if (reviewer && !NAME_PATTERN.test(reviewer)) return { code: 1, report: bad(`${reviewer} is not a member name`) };
  if (reviewer && !roleFileIn) return { code: 1, report: bad('--reviewer needs --instructions') };

  const owner = `agent ${stamp(now())} ${row.branch}`;
  const worktreeRel = `.worktrees/${slug}`;
  const roleText = (cwd: string) =>
    rowInstructions({
      branch: row.branch,
      brief: briefFile,
      id: row.id,
      reviewer,
      role: roleFileIn && readFileSync(roleFileIn, 'utf8').trim(),
      worktree: cwd,
    });

  const planned = path.join(await mainCheckout(), worktreeRel);
  if (roleText(planned).length > INSTRUCTIONS_MAX_CHARS) {
    return { code: 1, report: bad(`not spawning: the role instructions are over ${INSTRUCTIONS_MAX_CHARS} chars`) };
  }

  if (dryRun) {
    const cwd = planned;
    return {
      code: 0,
      report: [
        dim('dry run, nothing claimed or started. would run:'),
        dim(`claim ${row.id} as "${owner}" in ${worktreeRel}`),
        dim(`worktree ${cwd} on ${row.branch}`),
        dim(planLine({ cwd, model, name: slug, role: assign, room })),
        dim(`role instructions: ${roleText(cwd)}`),
        ok(`${row.id} is ready to spawn as ${slug} in #${room}`),
      ].join('\n'),
    };
  }

  const claimed = await queue(['claim', row.id, owner, worktreeRel]);
  if (claimed.code !== 0) return { code: 1, report: bad(`claim refused: ${claimed.stderr.trim()}`) };
  const lines = [ok(`claimed ${row.id} as ${owner}`)];
  const giveBack = async (why: string) => {
    await queue(['release', row.id]);
    return { code: 1, report: [...lines, bad(why), dim(`released ${row.id}`)].join('\n') };
  };
  const made = await worktree(row.branch);
  if (!made.ok) return giveBack(made.error);
  lines.push(ok(`worktree ${made.path}`));

  const sent = await spawnSeat({
    ...daemon,
    cwd: made.path,
    instructions: roleText(made.path),
    model,
    name: slug,
    role: assign,
    room,
  });
  if (!sent.ok) return giveBack(sent.error);
  return {
    code: 0,
    report: [...lines, ...seatedLines({ name: slug, role: assign, room, session: sent.session })].join('\n'),
  };
}

/** Seats a claude with no queue row through the product spawner, in `cwd`. It joins as `name` and waits for a role. */
export async function seatRun({
  assign = UNASSIGNED_ROLE,
  cwd,
  daemon,
  dryRun,
  model,
  name,
  room,
}: {
  assign?: string;
  cwd: string;
  daemon: Daemon;
  dryRun: boolean;
  model: string;
  name: string;
  room: string;
}) {
  if (!NAME_PATTERN.test(name) || (RESERVED_NAMES as readonly string[]).includes(name)) {
    return { code: 1, report: bad(`not spawning: ${name} is not a free member name (a-z, 0-9, dashes, up to 40)`) };
  }
  if (dryRun) {
    return {
      code: 0,
      report: [
        dim('dry run, nothing started. would run:'),
        dim(planLine({ cwd, model, name, role: assign, room })),
        ok(`${name} is ready to seat in #${room}`),
      ].join('\n'),
    };
  }
  const sent = await spawnSeat({ ...daemon, cwd, model, name, role: assign, room });
  if (!sent.ok) return { code: 1, report: bad(sent.error) };
  return { code: 0, report: seatedLines({ name, role: assign, room, session: sent.session }).join('\n') };
}

/** Stops a spawned seat through the product spawner: a row id stops the seat named after its branch. A row stays
 * claimed, so the reply says how to hand it back. */
export async function flockStop({
  daemon,
  queue = runQueue,
  room,
  target,
}: {
  daemon: Daemon;
  queue?: Runner;
  room?: string;
  target: string;
}) {
  const id = target.toUpperCase();
  const isRow = ROW_ID.test(target);
  const branch = isRow ? parseQueueRow({ id, listing: (await queue(['show', '--all'])).stdout })?.branch : undefined;
  if (isRow && !branch) return { code: 1, report: bad(`no row ${id} in the queue`) };
  const stopped = await runFlockStop({ ...daemon, name: branch ? branchSlug(branch) : target, room });
  if (!branch || stopped.code !== 0) return { code: stopped.code, report: stopped.output };
  const hint = [
    dim(`the row is still claimed. hand it back with queue.py release ${id}`),
    dim(`before removing its worktree: make app-clean WORKTREE=.worktrees/${branchSlug(branch)}`),
  ];
  return { code: 0, report: [stopped.output, ...hint].join('\n') };
}

/** Types `text` into a tmux claude session and submits it, so a nudge never sits unsent in the input box. */
export async function nudgeRun({
  session,
  settleMs,
  text,
  tmux = runTmux,
}: {
  session: string;
  settleMs?: number;
  text: string;
  tmux?: Runner;
}) {
  const found = await tmux(['has-session', '-t', session]);
  if (found.code !== 0) return { code: 1, report: bad(`no tmux session ${session}`) };
  const typed = await typePrompt(session, text, { run: tmux, settleMs });
  return typed === 'sent'
    ? { code: 0, report: ok(`sent to ${session}`) }
    : { code: 1, report: bad(untypedLine(session, typed)) };
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

/** Registers `spawn <row|agent>`, `flock [stop <row|name>]`, `nudge` and `reviews`. */
export function registerSpawn(program: Command) {
  const daemonDeps = (): Daemon => ({ dataDir: defaultDataDir(), fetch, url: daemonUrl() });

  program
    .command('spawn <row>')
    .description(
      'Claim a ready queue row and seat a Claude Code on it through the product spawner, or with `agent --as <name>` seat one with no row.',
    )
    .option('--room <room>', 'room the agent sits in', DEFAULT_ROOM)
    .option('--model <model>', 'claude model', DEFAULT_MODEL)
    .option('--brief <file>', 'brief a row agent reads first, else it runs the pickup skill')
    .option('--assign <role>', `role the agent holds from its first call, ${UNASSIGNED_ROLE} by default`)
    .option('--instructions <file>', 'with a row: role text put before the row in its instructions')
    .option(
      '--reviewer <name>',
      `with --instructions: the reviewer named in its review gate in place of @${DEFAULT_REVIEWER}`,
    )
    .option('--as <name>', 'with `agent`: the member name to seat')
    .option('--dry-run', 'print the plan, claim and start nothing')
    .action(
      async (
        row: string,
        options: {
          as?: string;
          assign?: string;
          brief?: string;
          dryRun?: boolean;
          instructions?: string;
          model: string;
          reviewer?: string;
          room: string;
        },
      ) => {
        const shared = { daemon: daemonDeps(), dryRun: Boolean(options.dryRun) };
        const result =
          row === 'agent'
            ? options.as
              ? await seatRun({ ...shared, ...options, cwd: await mainCheckout(), name: options.as })
              : { code: 1, report: bad('spawn agent needs --as <name>') }
            : await spawnRun({ ...shared, ...options, id: row.toUpperCase() });
        console.log(result.report);
        process.exitCode = result.code;
      },
    );

  const flock = program
    .command('flock')
    .description('List spawned seats, the same as `messhall flock`.')
    .option('--room <room>', 'only this room')
    .action(async (options: { room?: string }) => {
      const result = await runFlock({ ...daemonDeps(), room: options.room });
      console.log(result.output);
      process.exitCode = result.code;
    });
  flock
    .command('stop <target>')
    .description('Stop a spawned seat by name, or by queue row id for the seat named after its branch.')
    .option('--room <room>', 'the room, when the name is spawned in more than one')
    .action(async (target: string, options: { room?: string }) => {
      const result = await flockStop({ daemon: daemonDeps(), room: options.room, target });
      console.log(result.report);
      process.exitCode = result.code;
    });

  program
    .command('nudge <session> <text>')
    .description('Type a prompt into a tmux claude session and press Enter until it is sent.')
    .action(async (session: string, text: string) => {
      const result = await nudgeRun({ session, text });
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
