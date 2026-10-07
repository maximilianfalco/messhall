import type { Command } from 'commander';

import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { z } from 'zod';

import { readAgentKey } from '../../../src/cli/agentKey.js';
import { callTool, withAgentSession } from '../../../src/mcp/oneshot.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore, type RoomStore } from '../../../src/rooms/store.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';

import {
  appPids,
  buildApp,
  checkShotHome,
  isAccessory,
  leftoverApps,
  PULL_REQUEST_ANSWERS,
  strayApps,
  waitWindow,
} from './appShot.js';
import { spawnDaemon } from './daemon.js';

const PERF_PORT = 7797;
const PERF_HOME = '/tmp/messhall-tape-home-perf';
export const OUT_DIR = path.join(REPO_ROOT, 'demo', 'out', 'perf');
export const REPORT_FILE = path.join(OUT_DIR, 'report.json');
export const PERF_ROOM = 'perf';
/** The window opens on this quiet room, so the switch to the big one is what gets timed. */
export const LOBBY_ROOM = 'lobby';
export const PERF_POSTS = 5000;
export const PERF_MEMBERS = 60;
/** The first members sit active with a status, so their spinners run through the measurement. */
export const PERF_THINKING = 10;
export const PERF_WAITING = 20;
export const PERF_EVENTS = 50;
/** Members who post. The rest only sit, so the agents panel scans past every line for them. */
const POSTERS = 40;
/** Every this many posts, three posters leave and come back, so the transcript holds folds. */
const RUN_EVERY = 250;
const HUMAN_EVERY = 50;
const STEP_MS = 3000;
const CLAUDE = { name: 'claude-code', version: '2.1.289' };
const KINDS = ['claude', 'codex', 'other'] as const;
const TASKS = ['read the plan', 'wrote the test', 'ran the suite', 'fixed the lint', 'opened the diff'];
const PRS = Object.keys(PULL_REQUEST_ANSWERS);
const READY_WITHIN_MS = 240_000;
// The eager transcript took the app close to two minutes to digest the burst, so the report gets ten.
const REPORT_WITHIN_MS = 600_000;
const QUIT_WITHIN_MS = 5000;
const SETTLE_MS = 2500;

const run = promisify(execFile);

export const perfMember = (n: number) => `agent-${String(n).padStart(2, '0')}`;
const kindOf = (n: number) => KINDS[n % KINDS.length] ?? 'claude';

/** One post's text by index: a PR link every 11th, a mention every 7th, else plain words. */
export function perfText(i: number, members: number) {
  const task = TASKS[i % TASKS.length];
  if (i % 11 === 0) return `${task}, see ${PRS[(i / 11) % PRS.length]}`;
  if (i % 7 === 0) return `@${perfMember((i % members) + 1)} ${task}, can you check?`;
  return `step ${i + 1}: ${task}`;
}

/** A room with `posts` chat lines from `members` agents, a human line every 50th and a presence run every 250th. */
export function seedPerfRoom({
  dataDir,
  members = PERF_MEMBERS,
  now,
  posts = PERF_POSTS,
}: {
  dataDir: string;
  members?: number;
  now: Date;
  posts?: number;
}) {
  let at = now.getTime() - (posts + 10) * STEP_MS;
  const db = openDb({ dataDir });
  const store = createRoomStore({ db, now: () => new Date(at) });
  const posters = Math.min(POSTERS, members);
  const presenceRun = (i: number) => {
    for (const n of [1, 2, 3]) {
      const as = perfMember(((i + n) % posters) + 1);
      at += STEP_MS;
      store.leaveRoom({ as, room: PERF_ROOM });
    }
    for (const n of [1, 2, 3]) {
      const as = perfMember(((i + n) % posters) + 1);
      at += STEP_MS;
      store.joinRoom({ as, client: CLAUDE, kind: kindOf(n), room: PERF_ROOM });
    }
  };
  try {
    store.createRoom({ created_by: 'human', name: LOBBY_ROOM, topic: 'the room the window opens on' });
    for (let n = 1; n <= members; n += 1) {
      store.joinRoom({ as: perfMember(n), client: CLAUDE, kind: kindOf(n), room: PERF_ROOM });
    }
    for (let i = 0; i < posts; i += 1) {
      at += STEP_MS;
      if (i % RUN_EVERY === RUN_EVERY - 1) presenceRun(i);
      const human = i % HUMAN_EVERY === HUMAN_EVERY - 1;
      const text = human ? `how is it going, round ${(i + 1) / HUMAN_EVERY}` : perfText(i, members);
      store.postMessage({ from: human ? 'human' : perfMember((i % posters) + 1), room: PERF_ROOM, text });
    }
  } finally {
    db.close();
  }
}

/** Wakes the first members after the daemon started (its start marks every agent away): `thinking` of them
 * active with a status that links a PR, the next `waiting`. Everyone else stays in the away fold. */
export function seedPerfThinking({
  dataDir,
  now,
  thinking = PERF_THINKING,
  waiting = PERF_WAITING,
}: {
  dataDir: string;
  now: Date;
  thinking?: number;
  waiting?: number;
}) {
  const db = openDb({ dataDir });
  try {
    const store: RoomStore = createRoomStore({ db, now: () => now });
    for (let n = 1; n <= thinking; n += 1) {
      const as = perfMember(n);
      store.touch({ as, room: PERF_ROOM, state: 'active' });
      store.setStatus({ as, room: PERF_ROOM, status: `tests green on ${PRS[n % PRS.length]}, opening the PR` });
    }
    for (let n = thinking + 1; n <= thinking + waiting; n += 1) {
      store.touch({ as: perfMember(n), room: PERF_ROOM, state: 'waiting' });
    }
  } finally {
    db.close();
  }
}

const perfReportSchema = z.object({
  dash_fps: z.number(),
  dash_worst_frame_ms: z.number(),
  event_cpu_ms: z.number(),
  event_row_bodies: z.number(),
  event_wall_ms: z.number(),
  events: z.number(),
  idle_cpu_percent: z.number(),
  open_ms: z.number(),
  page_all_cpu_ms: z.number(),
  page_all_ms: z.number(),
  pages: z.number(),
  pull_request_reads: z.number(),
  resident_mb: z.number(),
  rows: z.number(),
  scroll_fps: z.number(),
  scroll_worst_frame_ms: z.number(),
});

export type PerfReport = z.infer<typeof perfReportSchema>;

const ms = (value: number) => `${Math.round(value)} ms`;

/** The report as table rows, one measure each. */
export function perfRows(report: PerfReport) {
  return [
    ['open the room', ms(report.open_ms)],
    [`idle cpu, ${PERF_THINKING} spinners, 5 s`, `${report.idle_cpu_percent.toFixed(1)} %`],
    [
      'page in every post',
      `${report.pages} pages, ${report.rows} rows, ${ms(report.page_all_ms)}, cpu ${ms(report.page_all_cpu_ms)}`,
    ],
    [
      'scroll 3,000 pt per s for 4 s',
      `${report.scroll_fps.toFixed(1)} fps, worst frame ${ms(report.scroll_worst_frame_ms)}`,
    ],
    ['dash top to bottom in 4 s', `${report.dash_fps.toFixed(1)} fps, worst frame ${ms(report.dash_worst_frame_ms)}`],
    [
      `${report.events} incoming posts`,
      `cpu ${report.event_cpu_ms.toFixed(1)} ms per post, ${Math.round(report.event_row_bodies)} row bodies per post, ${ms(report.event_wall_ms)} wall`,
    ],
    ['pr reads during the run', String(report.pull_request_reads)],
    ['resident memory at the end', `${Math.round(report.resident_mb)} MB`],
  ];
}

/** The launch args for the measuring app. No `-shotRoom`, since the switch to the big room is timed. */
export function perfArgs({ events, file }: { events: number; file: string }) {
  return [
    '-ApplePersistenceIgnoreState',
    'YES',
    '-shotAppearance',
    'light',
    '-appSettings',
    JSON.stringify(JSON.stringify({})),
    '-shotPerf',
    file,
    '-shotPerfRoom',
    PERF_ROOM,
    '-shotPerfEvents',
    String(events),
    '-shotPullRequests',
    JSON.stringify(JSON.stringify(PULL_REQUEST_ANSWERS)),
  ];
}

/** The launch args for a shot of the big room in one appearance. */
export function perfShotArgs(appearance: 'dark' | 'light') {
  return [
    '-ApplePersistenceIgnoreState',
    'YES',
    '-shotAppearance',
    appearance,
    '-appSettings',
    JSON.stringify(JSON.stringify({})),
    '-shotRoom',
    PERF_ROOM,
    '-shotPullRequests',
    JSON.stringify(JSON.stringify(PULL_REQUEST_ANSWERS)),
  ];
}

async function waitFile(file: string, deadline: number): Promise<string | undefined> {
  if (statSync(file, { throwIfNoEntry: false })) return;
  if (Date.now() > deadline) return `${path.basename(file)} did not land in time`;
  await sleep(250);
  return waitFile(file, deadline);
}

/** Joins once and posts `count` lines in a row, the burst the app measures. Gives the refusal text, if any. */
async function burst({ count, dataDir, url }: { count: number; dataDir: string; url: string }) {
  const session = await withAgentSession({ key: readAgentKey(dataDir), name: 'messhall-dev', url }, async client => {
    const joined = await callTool(client, 'join', { as: 'burst', room: PERF_ROOM });
    if (joined.isError) return joined.text;
    const postFrom = async (i: number): Promise<string | undefined> => {
      if (i >= count) return undefined;
      const posted = await callTool(client, 'post', { room: PERF_ROOM, text: perfText(i, PERF_MEMBERS) });
      return posted.isError ? posted.text : postFrom(i + 1);
    };
    const refused = await postFrom(0);
    const left = await callTool(client, 'leave', { room: PERF_ROOM });
    return refused ?? (left.isError ? left.text : undefined);
  });
  return session.ok ? session.value : `no session on ${url}`;
}

function launch({
  app,
  args,
  env,
  launched,
}: {
  app: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  launched: number[];
}) {
  const child = spawn(path.join(app, 'Contents', 'MacOS', 'Messhall'), args, { env, stdio: 'ignore' });
  if (child.pid) launched.push(child.pid);
  const exited = new Promise(resolve => {
    child.once('exit', resolve);
  });
  return {
    child,
    async quit() {
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(QUIT_WITHIN_MS)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
  };
}

async function checkWindow(pid: number) {
  const id = await waitWindow(pid);
  if (id === undefined) return 'no window within 30 s';
  const { stdout: info } = await run('lsappinfo', ['info', '-only', 'ApplicationType', String(pid)]);
  if (!isAccessory(info)) return `not an accessory app, it would show in the Dock: ${info.trim()}`;
  return id;
}

/** Launches the measuring app, feeds it the post burst when it asks, and reads its report. */
async function measure({
  app,
  env,
  events,
  home,
  launched,
  url,
}: {
  app: string;
  env: NodeJS.ProcessEnv;
  events: number;
  home: string;
  launched: number[];
  url: string;
}) {
  rmSync(REPORT_FILE, { force: true });
  rmSync(`${REPORT_FILE}.ready`, { force: true });
  const running = launch({ app, args: perfArgs({ events, file: REPORT_FILE }), env, launched });
  try {
    const window = await checkWindow(running.child.pid ?? 0);
    if (typeof window === 'string') return window;
    const notReady = await waitFile(`${REPORT_FILE}.ready`, Date.now() + READY_WITHIN_MS);
    if (notReady) return notReady;
    const refused = await burst({ count: events, dataDir: home, url });
    if (refused) return `burst refused: ${refused}`;
    const noReport = await waitFile(REPORT_FILE, Date.now() + REPORT_WITHIN_MS);
    if (noReport) return noReport;
    const parsed = perfReportSchema.safeParse(JSON.parse(readFileSync(REPORT_FILE, 'utf8')));
    return parsed.success ? parsed.data : `report has the wrong shape: ${parsed.error.message}`;
  } finally {
    await running.quit();
  }
}

/** Shoots the window into `file`, trying once more after a beat, since the window server refuses a window now and then. */
async function capture(window: number, file: string, tries = 2): Promise<string> {
  try {
    await run('screencapture', ['-o', '-x', '-l', String(window), file]);
    return file;
  } catch (error) {
    if (tries <= 1) return `screencapture failed: ${error instanceof Error ? error.message.trim() : String(error)}`;
    await sleep(1000);
    return capture(window, file, tries - 1);
  }
}

async function shoot({
  app,
  appearance,
  env,
  launched,
}: {
  app: string;
  appearance: 'dark' | 'light';
  env: NodeJS.ProcessEnv;
  launched: number[];
}) {
  const file = path.join(OUT_DIR, `perf-${appearance}.png`);
  rmSync(file, { force: true });
  const running = launch({ app, args: perfShotArgs(appearance), env, launched });
  try {
    const window = await checkWindow(running.child.pid ?? 0);
    if (typeof window === 'string') return window;
    await sleep(SETTLE_MS);
    return capture(window, file);
  } finally {
    await running.quit();
  }
}

/** Opens the big room, lets one agent post into it, and shoots: the new line has to sit at the bottom. */
async function shootFollow({
  app,
  env,
  home,
  launched,
  url,
}: {
  app: string;
  env: NodeJS.ProcessEnv;
  home: string;
  launched: number[];
  url: string;
}) {
  const file = path.join(OUT_DIR, 'perf-follow-light.png');
  rmSync(file, { force: true });
  const running = launch({ app, args: perfShotArgs('light'), env, launched });
  try {
    const window = await checkWindow(running.child.pid ?? 0);
    if (typeof window === 'string') return window;
    await sleep(SETTLE_MS);
    const refused = await burst({ count: 1, dataDir: home, url });
    if (refused) return `agent post refused: ${refused}`;
    await sleep(SETTLE_MS);
    return capture(window, file);
  } finally {
    await running.quit();
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Seeds the big room on a scratch daemon, builds the app, measures it and shoots the room light and dark. */
async function appPerf({ events, home, port, posts }: { events: number; home: string; port: number; posts: number }) {
  const refused = checkShotHome(home);
  if (refused) return { code: 1, report: bad(refused) };
  rmSync(home, { force: true, recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  seedPerfRoom({ dataDir: home, now: new Date(), posts });

  const app = buildApp();
  if (!app) return { code: 1, report: bad('make app failed') };
  // No summaries: the burst would cross the room's next summary mark and pay claude for it on every run.
  const daemon = await spawnDaemon({ detached: false, env: { MESSHALL_SUMMARIES: 'off' }, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  seedPerfThinking({ dataDir: home, now: new Date() });

  const env = { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(port) };
  const launched: number[] = [];
  const before = appPids(app);
  let report: PerfReport | string;
  const shots: string[][] = [];
  try {
    report = await measure({ app, env, events, home, launched, url: daemon.url });
    shots.push(['perf-light', await shoot({ app, appearance: 'light', env, launched })]);
    shots.push(['perf-dark', await shoot({ app, appearance: 'dark', env, launched })]);
    shots.push(['perf-follow-light', await shootFollow({ app, env, home, launched, url: daemon.url })]);
  } finally {
    await daemon.stop();
  }
  const left = leftoverApps({ isAlive: processAlive, kill: pid => process.kill(pid, 'SIGKILL'), launched });
  const strays = strayApps({ after: appPids(app), before });
  const failedShots = shots.filter(([, file]) => !file?.startsWith('/'));
  const lines = [
    typeof report === 'string'
      ? bad(report)
      : formatTable(['measure', `${posts} posts, ${PERF_MEMBERS} members`], perfRows(report)),
    '',
    formatTable(['shot', 'file'], shots),
    '',
    typeof report === 'string' ? bad('no report') : ok(`report in ${REPORT_FILE}`),
    left.length
      ? bad(`${left.length} launched apps did not quit and were killed: ${left.join(', ')}`)
      : ok('every launched app quit'),
    strays.length ? bad(`apps from ${app} still running: ${strays.join(', ')}`) : ok(`no app from ${app} left running`),
    dim('debug build, so every number is above what the installed app sees'),
  ];
  const code = typeof report === 'string' || failedShots.length || left.length || strays.length ? 1 : 0;
  return { code, report: lines.join('\n') };
}

/** Registers `app-perf [--port <n>] [--home <dir>] [--posts <n>] [--events <n>]`. */
export function registerAppPerf(program: Command) {
  program
    .command('app-perf')
    .description(
      'Seed a scratch daemon with one big room, build the Mac app and measure it there: open time, idle cpu with spinners, paging in every post, scroll frame rate, cpu per incoming post, memory. Then shoot the room light and dark.',
    )
    .option('--port <port>', 'scratch daemon port', String(PERF_PORT))
    .option('--home <dir>', 'scratch MESSHALL_HOME, wiped first', PERF_HOME)
    .option('--posts <n>', 'chat lines in the room', String(PERF_POSTS))
    .option('--events <n>', 'posts sent while the app measures cpu per post', String(PERF_EVENTS))
    .action(async (options: { events: string; home: string; port: string; posts: string }) => {
      const result = await appPerf({
        events: Number(options.events),
        home: options.home,
        port: Number(options.port),
        posts: Number(options.posts),
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
