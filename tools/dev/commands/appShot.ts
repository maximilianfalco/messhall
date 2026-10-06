import type { Command } from 'commander';

import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, formatTable, ok } from '../lib/print.js';

import { spawnDaemon } from './daemon.js';

const SHOT_PORT = 7796;
const SHOT_HOME = '/tmp/messhall-tape-home-app';
const OUT_DIR = path.join(REPO_ROOT, 'demo', 'out', 'shots');
const BUNDLE_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'bundle.sh');
const WINDOWS_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'windows.swift');
const WINDOW_WITHIN_MS = 30_000;
// Time for the snapshot to load and the transcript to scroll before the shot.
const SETTLE_MS = 2500;
const POST_TEXT = 'thanks both. ship it once the e2e run is green';

const SHOTS = [
  { appearance: 'light', name: 'window-light' },
  { appearance: 'dark', name: 'window-dark' },
  { appearance: 'light', name: 'post-light', post: true },
  { appearance: 'dark', name: 'post-dark' },
  { appearance: 'light', name: 'new-room-light', newRoom: 'Release Notes' },
  { appearance: 'dark', name: 'new-room-dark', newRoom: 'launch-week' },
  { appearance: 'light', name: 'standing-light', room: 'release-notes' },
  { appearance: 'dark', name: 'standing-dark', room: 'release-notes' },
  { appearance: 'light', name: 'closed-light', room: 'billing' },
  { appearance: 'dark', name: 'closed-dark', room: 'billing' },
] as const;
// Shot after the daemon stops, so the window shows its empty state.
const DOWN_SHOTS = [
  { appearance: 'light', name: 'down-light' },
  { appearance: 'dark', name: 'down-dark' },
] as const;

const run = promisify(execFile);

/** The id of the app's main window in a `windows.swift` listing: the largest layer 0 window. */
export function pickWindow(listing: string) {
  const windows = listing
    .trim()
    .split('\n')
    .map(line => {
      const [id = 0, layer, width = 0, height = 0] = line.split(' ').map(Number);
      return { area: width * height, id, layer };
    })
    .filter(window => window.layer === 0 && window.area > 0);
  return windows.toSorted((a, b) => b.area - a.area)[0]?.id;
}

/** Why `home` cannot hold the shot's scratch rooms, or undefined when it can. */
export function checkShotHome(home: string) {
  const real = path.join(homedir(), 'Library', 'Application Support', 'messhall');
  if (path.resolve(home) === real) return `refusing ${home}, it is the real data dir`;
}

/** Seeds four rooms on a fresh db so every screen has something to show. Presence follows `now`. */
export function seedShotRooms({ dataDir, now }: { dataDir: string; now: Date }) {
  let at = now.getTime() - 20 * 60_000;
  const db = openDb({ dataDir });
  const store = createRoomStore({ db, now: () => new Date(at) });
  const step = (ms: number) => {
    at += ms;
  };
  try {
    store.joinRoom({ as: 'writer', kind: 'codex', room: 'docs-sync' });
    store.postMessage({ from: 'writer', room: 'docs-sync', text: 'drafting the changelog for the currency change' });
    step(5 * 60_000);
    store.joinRoom({ as: 'ledger', kind: 'claude', room: 'billing' });
    store.postMessage({ done: true, from: 'ledger', room: 'billing', text: 'invoices backfilled' });
    step(5 * 60_000);
    store.joinRoom({ as: 'qa', kind: 'other', room: 'checkout' });
    store.postMessage({
      from: 'qa',
      room: 'checkout',
      text: '@all i will rerun the checkout e2e once both sides land',
    });
    at = now.getTime() - 60_000;
    store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    store.joinRoom({ as: 'web', kind: 'codex', room: 'checkout' });
    step(10_000);
    store.postMessage({
      from: 'api',
      room: 'checkout',
      text: '@web the order schema has a currency field now. amounts are in minor units',
    });
    step(10_000);
    store.postMessage({ from: 'web', room: 'checkout', text: '@api got it, updating the form and the zod schema' });
    step(10_000);
    store.postMessage({ done: true, from: 'web', room: 'checkout', text: 'form updated, tests green' });
    step(10_000);
    store.touch({ as: 'web', room: 'checkout', state: 'waiting' });
    at = now.getTime();
    store.postMessage({ from: 'api', room: 'checkout', text: '@qa both sides are merged, over to you' });
    store.createRoom({ created_by: 'human', name: 'release-notes', topic: 'notes for the v2 launch' });
    store.joinRoom({ as: 'writer', kind: 'codex', room: 'release-notes' });
    store.postMessage({ from: 'writer', room: 'release-notes', text: 'first pass of the notes is up, @human take a look' });
    store.postMessage({ done: true, from: 'writer', room: 'release-notes', text: 'notes drafted' });
    store.sweepPresence();
  } finally {
    db.close();
  }
}

type Shot = (typeof SHOTS)[number] | (typeof DOWN_SHOTS)[number];

async function waitWindow(pid: number, deadline = Date.now() + WINDOW_WITHIN_MS): Promise<number | undefined> {
  const { stdout } = await run('swift', [WINDOWS_SCRIPT, String(pid)]);
  const id = pickWindow(stdout);
  if (id !== undefined || Date.now() > deadline) return id;
  await sleep(500);
  return waitWindow(pid, deadline);
}

async function shoot({ app, env, shot }: { app: string; env: NodeJS.ProcessEnv; shot: Shot }) {
  const args = [
    '-shotAppearance',
    shot.appearance,
    ...('post' in shot ? ['-shotPost', POST_TEXT] : []),
    ...('room' in shot ? ['-shotRoom', shot.room] : []),
    ...('newRoom' in shot ? ['-shotNewRoom', shot.newRoom] : []),
  ];
  const child = spawn(path.join(app, 'Contents', 'MacOS', 'Messhall'), args, { env, stdio: 'ignore' });
  const exited = new Promise(resolve => {
    child.once('exit', resolve);
  });
  try {
    const id = await waitWindow(child.pid ?? 0);
    if (id === undefined) return `no window within ${WINDOW_WITHIN_MS}ms`;
    await sleep(SETTLE_MS);
    const file = path.join(OUT_DIR, `${shot.name}.png`);
    await run('screencapture', ['-o', '-x', '-l', String(id), file]);
    return file;
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
}

/** One app at a time, since each shot finds the window by the app's pid. */
const shootAll = ({ app, env, shots }: { app: string; env: NodeJS.ProcessEnv; shots: readonly Shot[] }) =>
  shots.reduce<Promise<string[][]>>(
    async (done, shot) => [...(await done), [shot.name, await shoot({ app, env, shot })]],
    Promise.resolve([]),
  );

function buildApp() {
  const result = spawnSync('bash', [BUNDLE_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) return;
  return result.stdout.trim().split('\n').at(-1);
}

/** Seeds a scratch daemon, builds the app, and shoots the menu bar label, the window, a post, the New Room sheet, a standing room, a closed room and the daemon-down state in light and dark. */
async function appShot({ home, port }: { home: string; port: number }) {
  const refused = checkShotHome(home);
  if (refused) return { code: 1, report: bad(refused) };
  rmSync(home, { force: true, recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  seedShotRooms({ dataDir: home, now: new Date() });

  const app = buildApp();
  if (!app) return { code: 1, report: bad('make app failed') };
  const daemon = await spawnDaemon({ detached: false, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };

  const env = { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(port) };
  const rows: string[][] = [];
  try {
    spawnSync(path.join(app, 'Contents', 'MacOS', 'Messhall'), ['-renderStatus', OUT_DIR], { env });
    rows.push(['menu-light', path.join(OUT_DIR, 'menu-light.png')], ['menu-dark', path.join(OUT_DIR, 'menu-dark.png')]);
    rows.push(...(await shootAll({ app, env, shots: SHOTS })));
  } finally {
    await daemon.stop();
  }
  rows.push(...(await shootAll({ app, env, shots: DOWN_SHOTS })));
  const sized = rows.map(([name = '', file = '']) => {
    const size = file.startsWith('/')
      ? `${Math.round((statSync(file, { throwIfNoEntry: false })?.size ?? 0) / 1000)} kB`
      : '';
    return [name, file, size];
  });
  const failed = sized.filter(([, file, size]) => !file?.startsWith('/') || size === '0 kB');
  const table = formatTable(['shot', 'file', 'size'], sized);
  const verdict = failed.length ? bad(`${failed.length} shots failed`) : ok(`${sized.length} shots in ${OUT_DIR}`);
  return { code: failed.length ? 1 : 0, report: [table, '', verdict].join('\n') };
}

/** Registers `app-shot [--port <n>] [--home <dir>]`. */
export function registerAppShot(program: Command) {
  program
    .command('app-shot')
    .description(
      'Seed a scratch daemon, build the Mac app and screenshot the menu bar, window, post, New Room sheet, standing and closed rooms and daemon-down state in light and dark.',
    )
    .option('--port <port>', 'scratch daemon port', String(SHOT_PORT))
    .option('--home <dir>', 'scratch MESSHALL_HOME, wiped first', SHOT_HOME)
    .action(async (options: { home: string; port: string }) => {
      const result = await appShot({ home: options.home, port: Number(options.port) });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
