import type { Command } from 'commander';

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  forgetLayout,
  isAccessory,
  leftoverApps,
  PULL_REQUEST_ANSWERS,
  strayApps,
  waitWindow,
  WINDOWS_SCRIPT,
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
/** Smaller rooms beside the big one, so the sidebar and the agents panel look like a busy day. */
export const PERF_ROOMS = 12;
const SIDE_MEMBERS = 8;
const SIDE_POSTS = 40;
/** Agents woken per side room, so spinners and the working count spread across rooms. */
const SIDE_THINKING = 2;
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
export const perfRoom = (n: number) => `room-${String(n).padStart(2, '0')}`;
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
  rooms = PERF_ROOMS,
}: {
  dataDir: string;
  members?: number;
  now: Date;
  posts?: number;
  rooms?: number;
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
    for (let r = 1; r <= rooms; r += 1) {
      const room = perfRoom(r);
      for (let n = 1; n <= SIDE_MEMBERS; n += 1) {
        store.joinRoom({ as: perfMember(n), client: CLAUDE, kind: kindOf(n), room });
      }
      for (let i = 0; i < SIDE_POSTS; i += 1) {
        at += STEP_MS;
        store.postMessage({ from: perfMember((i % SIDE_MEMBERS) + 1), room, text: perfText(i, SIDE_MEMBERS) });
      }
    }
  } finally {
    db.close();
  }
}

/** Wakes the first members after the daemon started (its start marks every agent away): `thinking` of them
 * active with a status that links a PR, the next `waiting`. Everyone else stays in the away fold. Two agents
 * per side room wake too. The big room also gets an open question and two agreements, one settled and one
 * open, since a daemon start expires every pending ask. */
export function seedPerfThinking({
  dataDir,
  now,
  rooms = PERF_ROOMS,
  thinking = PERF_THINKING,
  waiting = PERF_WAITING,
}: {
  dataDir: string;
  now: Date;
  rooms?: number;
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
    for (let r = 1; r <= rooms; r += 1) {
      for (let n = 1; n <= SIDE_THINKING; n += 1) {
        const as = perfMember(n);
        store.touch({ as, room: perfRoom(r), state: 'active' });
        store.setStatus({ as, room: perfRoom(r), status: `on step ${r}, tests green` });
      }
    }
    if (thinking > 0) {
      store.askQuestion({
        as: perfMember(1),
        options: ['ship it', 'wait for review'],
        question: 'the cents migration is green on staging. merge it today?',
        room: PERF_ROOM,
      });
    }
    if (thinking > 1) {
      const settled = store.proposeAgreement({
        as: perfMember(1),
        room: PERF_ROOM,
        text: 'amounts move to minor units, the old total field stays until friday',
        with: [perfMember(2)],
      });
      if (settled.ok) store.confirmAgreement({ as: perfMember(2), id: settled.agreement.id, room: PERF_ROOM });
      store.proposeAgreement({
        as: perfMember(2),
        room: PERF_ROOM,
        text: 'the web form adapts once the api is on main',
        with: [perfMember(1)],
      });
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
  panel_fps: z.number(),
  panel_worst_frame_ms: z.number(),
  sidebar_fps: z.number(),
  sidebar_worst_frame_ms: z.number(),
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
      'sidebar hides and shows, 0.6 s each',
      `${report.sidebar_fps.toFixed(1)} fps, worst frame ${ms(report.sidebar_worst_frame_ms)}`,
    ],
    [
      'the same with the agents panel open',
      `${report.panel_fps.toFixed(1)} fps, worst frame ${ms(report.panel_worst_frame_ms)}`,
    ],
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
  forgetLayout(app);
  const errors = openSync(path.join(OUT_DIR, 'app.stderr'), 'a');
  const child = spawn(path.join(app, 'Contents', 'MacOS', 'Messhall'), args, {
    env,
    stdio: ['ignore', 'ignore', errors],
  });
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
async function capture(window: number, file: string, child: ChildProcess, tries = 2): Promise<string> {
  const pid = child.pid ?? 0;
  try {
    await run('screencapture', ['-o', '-x', '-l', String(window), file]);
    return file;
  } catch (error) {
    if (tries > 1) {
      await sleep(1000);
      return capture(window, file, child, tries - 1);
    }
    const { stdout: windows } = await run('swift', [WINDOWS_SCRIPT, String(pid)]).catch(() => ({ stdout: '?' }));
    const { stdout: cpu } = await run('ps', ['-o', '%cpu=', '-p', String(pid)]).catch(() => ({ stdout: '?' }));
    const why = error instanceof Error ? error.message.trim() : String(error);
    const state = `exit ${child.exitCode} signal ${child.signalCode}`;
    return `screencapture failed: ${why} (${state}, windows ${windows.trim().replaceAll('\n', ', ')}, cpu ${cpu.trim()})`;
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
    // Awaited here, else the finally quits the app under the capture.
    const shot = await capture(window, file, running.child);
    return shot;
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
    // Awaited here, else the finally quits the app under the capture.
    const shot = await capture(window, file, running.child);
    return shot;
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
async function appPerf({
  events,
  home,
  measure: wantsMeasure,
  port,
  posts,
  rooms,
}: {
  events: number;
  home: string;
  measure: boolean;
  port: number;
  posts: number;
  rooms: number;
}) {
  const refused = checkShotHome(home);
  if (refused) return { code: 1, report: bad(refused) };
  rmSync(home, { force: true, recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  seedPerfRoom({ dataDir: home, now: new Date(), posts, rooms });

  const app = buildApp();
  if (!app) return { code: 1, report: bad('make app failed') };
  // No summaries: the burst would cross the room's next summary mark and pay claude for it on every run.
  const daemon = await spawnDaemon({ detached: false, env: { MESSHALL_SUMMARIES: 'off' }, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  seedPerfThinking({ dataDir: home, now: new Date(), rooms });

  const env = { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(port) };
  const launched: number[] = [];
  const before = appPids(app);
  let report: PerfReport | string;
  const shots: string[][] = [];
  try {
    report = wantsMeasure ? await measure({ app, env, events, home, launched, url: daemon.url }) : 'skipped';
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
      ? dim(report)
      : formatTable(['measure', `${posts} posts, ${PERF_MEMBERS} members, ${rooms} side rooms`], perfRows(report)),
    '',
    formatTable(['shot', 'file'], shots),
    '',
    typeof report === 'string' ? dim('no report') : ok(`report in ${REPORT_FILE}`),
    left.length
      ? bad(`${left.length} launched apps did not quit and were killed: ${left.join(', ')}`)
      : ok('every launched app quit'),
    strays.length ? bad(`apps from ${app} still running: ${strays.join(', ')}`) : ok(`no app from ${app} left running`),
    dim('debug build, so every number is above what the installed app sees'),
  ];
  const noReport = wantsMeasure && typeof report === 'string';
  const code = noReport || failedShots.length || left.length || strays.length ? 1 : 0;
  return { code, report: lines.join('\n') };
}

/** Registers `app-perf [--port <n>] [--home <dir>] [--posts <n>] [--events <n>] [--rooms <n>] [--shots-only]`. */
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
    .option('--rooms <n>', 'smaller rooms beside the big one', String(PERF_ROOMS))
    .option('--shots-only', 'skip the measurement, only shoot the room')
    .action(
      async (options: {
        events: string;
        home: string;
        port: string;
        posts: string;
        rooms: string;
        shotsOnly?: boolean;
      }) => {
        const result = await appPerf({
          events: Number(options.events),
          home: options.home,
          measure: !options.shotsOnly,
          port: Number(options.port),
          posts: Number(options.posts),
          rooms: Number(options.rooms),
        });
        console.log(result.report);
        process.exitCode = result.code;
      },
    );
}
