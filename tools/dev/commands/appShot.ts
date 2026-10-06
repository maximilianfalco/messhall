import type { Command } from 'commander';

import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { runPost } from '../../../src/cli/post.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore, type RoomStore } from '../../../src/rooms/store.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, formatTable, ok } from '../lib/print.js';

import { spawnDaemon } from './daemon.js';

const SHOT_PORT = 7796;
const SHOT_HOME = '/tmp/messhall-tape-home-app';
const OUT_DIR = path.join(REPO_ROOT, 'demo', 'out', 'shots');
const BUNDLE_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'bundle.sh');
const WINDOWS_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'windows.swift');
const RECORD_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'record.swift');
const RECORDER = path.join(REPO_ROOT, 'demo', 'out', 'record');
// The app waits this long before each sidebar toggle, so the take holds both slides.
const TOGGLE_PAUSE_S = 2.5;
const RECORD_S = 7;
const GIF_LIMIT_BYTES = 10_000_000;
const WINDOW_WITHIN_MS = 30_000;
// Time for the snapshot to load and the transcript to scroll before the shot.
const SETTLE_MS = 2500;
const POST_TEXT = 'thanks both. ship it once the e2e run is green';
// Lands below a transcript scrolled to the top, so the jump pill shows.
const AGENT_POST = { as: 'editor', room: 'docs-sync', text: 'the glossary page is updated too' };

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
  { agentPost: true, appearance: 'light', name: 'pill-light', room: 'docs-sync', scrollTop: true },
  { agentPost: true, appearance: 'dark', name: 'pill-dark', room: 'docs-sync', scrollTop: true },
  { appearance: 'light', muted: true, name: 'muted-light' },
  { appearance: 'dark', muted: true, name: 'muted-dark' },
  { appearance: 'light', name: 'folded-light', room: 'handoff' },
  { appearance: 'dark', name: 'folded-dark', room: 'handoff' },
  { appearance: 'light', name: 'expanded-light', openFolds: true, room: 'handoff' },
  { appearance: 'dark', name: 'expanded-dark', openFolds: true, room: 'handoff' },
  { appearance: 'light', name: 'settings-appearance-light', settings: 'appearance' },
  { appearance: 'dark', name: 'settings-appearance-dark', settings: 'appearance' },
  { appearance: 'light', name: 'settings-avatars-light', settings: 'avatars' },
  { appearance: 'dark', name: 'settings-avatars-dark', settings: 'avatars' },
  { appearance: 'light', name: 'settings-notifications-light', settings: 'notifications' },
  { appearance: 'dark', name: 'settings-notifications-dark', settings: 'notifications' },
] as const;
// Posts as the human first, so the take also shows the right side row and the scroll landing flush.
const RECORDING = { appearance: 'light', name: 'sidebar-toggle', post: true, toggleSidebar: true } as const;
// The room the window opens on, muted through the app's settings.
const MUTED = { mutedRooms: ['checkout'] };
// Each Settings pane with something changed, so a pick and a Reset show.
const PANE_SETTINGS = {
  appearance: { accent: 'purple' },
  avatars: { avatars: { colors: { web: { blue: 0.42, green: 0.42, red: 0.05 } } } },
  notifications: { mutedRooms: ['billing'] },
} as const;
// Shot after the daemon stops, so the window shows its empty state.
const DOWN_SHOTS = [
  { appearance: 'light', name: 'down-light' },
  { appearance: 'dark', name: 'down-dark' },
] as const;

const QUIT_WITHIN_MS = 5000;
// The window's own layer (0, or 3 once floated for a recording), never the menu bar label's 25.
const WINDOW_LAYERS = [0, 3];

const run = promisify(execFile);
const CLAUDE = { name: 'claude-code', version: '2.1.289' };
// Enough lines in docs-sync that its transcript scrolls, for the jump pill shot.
const CHANGELOG_PAGES = Array.from({ length: 24 }, (_, i) => `api reference part ${i + 1}`);

/** The id of the app's main window in a `windows.swift` listing: the largest window on a window layer. */
export function pickWindow(listing: string) {
  const windows = listing
    .trim()
    .split('\n')
    .map(line => {
      const [id = 0, layer, width = 0, height = 0] = line.split(' ').map(Number);
      return { area: width * height, id, layer };
    })
    .filter(window => WINDOW_LAYERS.includes(window.layer ?? -1) && window.area > 0);
  return windows.toSorted((a, b) => b.area - a.area)[0]?.id;
}

/** Why `home` cannot hold the shot's scratch rooms, or undefined when it can. */
export function checkShotHome(home: string) {
  const real = path.join(homedir(), 'Library', 'Application Support', 'messhall');
  if (path.resolve(home) === real) return `refusing ${home}, it is the real data dir`;
}

/** A room with runs of joins and leaves between posts, so the transcript shows folded and open runs. */
function seedHandoff({ step, store }: { step: (ms: number) => void; store: RoomStore }) {
  const room = 'handoff';
  const presence = (lines: [string, 'join' | 'leave', string?][]) =>
    lines.forEach(([as, change, note]) => {
      step(20_000);
      if (change === 'join') store.joinRoom({ as, client: CLAUDE, kind: 'claude', room });
      else store.leaveRoom({ as, note, room });
    });
  presence([
    ['api', 'join'],
    ['web', 'join'],
    ['qa', 'join'],
  ]);
  store.postMessage({ from: 'api', room, text: '@web i will take the migration, the form is yours' });
  store.postMessage({ from: 'web', room, text: '@api sounds good, starting on the form now' });
  presence([
    ['web', 'leave', 'back after lunch'],
    ['qa', 'leave'],
    ['web', 'join'],
    ['qa', 'join'],
  ]);
  store.postMessage({ from: 'api', room, text: '@web @qa the migration is in, over to you' });
  presence([
    ['web', 'leave'],
    ['qa', 'leave'],
  ]);
}

/** Seeds five rooms on a fresh db so every screen has something to show. Presence follows `now`. */
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
    CHANGELOG_PAGES.forEach(page => {
      step(10_000);
      store.postMessage({ from: 'writer', room: 'docs-sync', text: `updated the ${page} page for minor units` });
    });
    step(5 * 60_000);
    store.joinRoom({ as: 'ledger', client: CLAUDE, kind: 'claude', room: 'billing' });
    store.postMessage({ done: true, from: 'ledger', room: 'billing', text: 'invoices backfilled' });
    seedHandoff({ step, store });
    step(5 * 60_000);
    store.joinRoom({ as: 'qa', client: { name: 'opencode', version: '1.18.34' }, kind: 'other', room: 'checkout' });
    store.postMessage({
      from: 'qa',
      room: 'checkout',
      text: '@all i will rerun the checkout e2e once both sides land',
    });
    step(10_000);
    store.joinRoom({ as: 'ci', client: { name: 'messhall-cli', version: '0.1.0' }, kind: 'other', room: 'checkout' });
    store.postMessage({ from: 'ci', room: 'checkout', text: 'nightly e2e on main is green' });
    store.leaveRoom({ as: 'ci', room: 'checkout' });
    at = now.getTime() - 60_000;
    store.joinRoom({ as: 'api', client: CLAUDE, kind: 'claude', room: 'checkout' });
    store.joinRoom({
      as: 'web',
      client: { name: 'codex-mcp-client', version: '0.160.1' },
      kind: 'codex',
      room: 'checkout',
    });
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
    store.postMessage({
      from: 'writer',
      room: 'release-notes',
      text: 'first pass of the notes is up, @human take a look',
    });
    store.postMessage({ done: true, from: 'writer', room: 'release-notes', text: 'notes drafted' });
    store.sweepPresence();
  } finally {
    db.close();
  }
}

/** Kills each launched app that is still alive and returns those pids, so a shot run never leaves one behind. */
export function leftoverApps({
  isAlive,
  kill,
  launched,
}: {
  isAlive: (pid: number) => boolean;
  kill: (pid: number) => void;
  launched: number[];
}) {
  const left = launched.filter(isAlive);
  left.forEach(kill);
  return left;
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type Shot = (typeof SHOTS)[number] | (typeof DOWN_SHOTS)[number] | typeof RECORDING;

const shotFile = (shot: Shot) => path.join(OUT_DIR, `${shot.name}.png`);
const windowFile = (shot: Shot) => path.join(OUT_DIR, `${shot.name}.window`);

/** Waits for the app to write a sheet shot. Gives an error text when none lands in time. */
async function waitFile(file: string, deadline = Date.now() + WINDOW_WITHIN_MS): Promise<string | undefined> {
  if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 0) return;
  if (Date.now() > deadline) return `no sheet drawn within ${WINDOW_WITHIN_MS}ms`;
  await sleep(250);
  return waitFile(file, deadline);
}

/** The launch args for one shot. The real app shares the bundle id, so a window closed there would stay shut here. */
export function shotArgs(shot: Shot) {
  return [
    '-ApplePersistenceIgnoreState',
    'YES',
    '-shotAppearance',
    shot.appearance,
    ...('post' in shot ? ['-shotPost', POST_TEXT] : []),
    '-appSettings',
    // A launch arg is read as a plist, so the JSON goes in as a quoted plist string.
    JSON.stringify(
      JSON.stringify({
        ...('muted' in shot ? MUTED : {}),
        ...('settings' in shot ? { pane: shot.settings, ...PANE_SETTINGS[shot.settings] } : {}),
      }),
    ),
    ...('settings' in shot ? ['-shotSettings', windowFile(shot)] : []),
    ...('room' in shot ? ['-shotRoom', shot.room] : []),
    ...('newRoom' in shot ? ['-shotNewRoom', shot.newRoom, '-shotSheet', shotFile(shot)] : []),
    ...('scrollTop' in shot ? ['-shotScrollTop', 'YES'] : []),
    ...('openFolds' in shot ? ['-shotOpenFolds', 'YES'] : []),
    ...('toggleSidebar' in shot ? ['-shotToggleSidebar', String(TOGGLE_PAUSE_S)] : []),
  ];
}

/** App pids from this checkout's build that started during the run. Ones already running, like the real app, stay out. */
export function strayApps({ after, before }: { after: number[]; before: number[] }) {
  return after.filter(pid => !before.includes(pid));
}

/** Whether an `lsappinfo info -only ApplicationType` line says the app runs as an accessory, with no Dock icon. */
export function isAccessory(lsappinfo: string) {
  return /"ApplicationType"\s*=\s*"UIElement"/.test(lsappinfo);
}

/** Pids running this build's app binary, matched by its full path. */
function appPids(app: string) {
  const result = spawnSync('pgrep', ['-f', path.join(app, 'Contents', 'MacOS', 'Messhall')], { encoding: 'utf8' });
  return result.stdout.split('\n').filter(Boolean).map(Number);
}

/** The Settings window's number, which the app writes once Settings is up, or an error text. */
async function settingsWindow(shot: Shot) {
  const file = windowFile(shot);
  return (await waitFile(file)) ?? readFileSync(file, 'utf8').trim();
}

async function waitWindow(pid: number, deadline = Date.now() + WINDOW_WITHIN_MS): Promise<number | undefined> {
  const { stdout } = await run('swift', [WINDOWS_SCRIPT, String(pid)]);
  const id = pickWindow(stdout);
  if (id !== undefined || Date.now() > deadline) return id;
  await sleep(500);
  return waitWindow(pid, deadline);
}

async function shoot({
  app,
  env,
  launched,
  shot,
}: {
  app: string;
  env: NodeJS.ProcessEnv;
  launched: number[];
  shot: Shot;
}) {
  rmSync(shotFile(shot), { force: true });
  rmSync(windowFile(shot), { force: true });
  const child = spawn(path.join(app, 'Contents', 'MacOS', 'Messhall'), shotArgs(shot), { env, stdio: 'ignore' });
  if (child.pid) launched.push(child.pid);
  const exited = new Promise(resolve => {
    child.once('exit', resolve);
  });
  try {
    const id = await waitWindow(child.pid ?? 0);
    if (id === undefined) return `no window within ${WINDOW_WITHIN_MS}ms`;
    const { stdout: info } = await run('lsappinfo', ['info', '-only', 'ApplicationType', String(child.pid)]);
    if (!isAccessory(info)) return `not an accessory app, it would show in the Dock: ${info.trim()}`;
    if ('agentPost' in shot) {
      await sleep(SETTLE_MS);
      const posted = await runPost({
        ...AGENT_POST,
        dataDir: env.MESSHALL_HOME ?? '',
        url: `http://127.0.0.1:${env.MESSHALL_PORT}`,
      });
      if (posted.code !== 0) return `agent post failed: ${posted.output}`;
    }
    if ('toggleSidebar' in shot) {
      const mov = path.join(OUT_DIR, `${shot.name}.mov`);
      await run(RECORDER, [String(child.pid), String(RECORD_S), mov]);
      return mov;
    }
    const file = shotFile(shot);
    // screencapture refuses a window with a sheet on an accessory app, so the app draws the sheet itself.
    if ('newRoom' in shot) return (await waitFile(file)) ?? file;
    await sleep(SETTLE_MS);
    const target = 'settings' in shot ? await settingsWindow(shot) : String(id);
    if (!/^\d+$/.test(target)) return target;
    await run('screencapture', ['-o', '-x', '-l', target, file]);
    return file;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(QUIT_WITHIN_MS)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

/** One app at a time, since each shot finds the window by the app's pid. */
const shootAll = ({
  app,
  env,
  launched,
  shots,
}: {
  app: string;
  env: NodeJS.ProcessEnv;
  launched: number[];
  shots: readonly Shot[];
}) =>
  shots.reduce<Promise<string[][]>>(
    async (done, shot) => [...(await done), [shot.name, await shoot({ app, env, launched, shot })]],
    Promise.resolve([]),
  );

/** Builds the window recorder. Plain `swift` from the command line tools crashes on ScreenCaptureKit, so Xcode's is used when present. */
function buildRecorder() {
  const xcode = '/Applications/Xcode.app/Contents/Developer';
  const env = { ...process.env, ...(statSync(xcode, { throwIfNoEntry: false }) ? { DEVELOPER_DIR: xcode } : {}) };
  return spawnSync('swiftc', ['-O', RECORD_SCRIPT, '-o', RECORDER], { env, stdio: 'inherit' }).status === 0;
}

/** Turns the take into a gif for the PR. Gives an error text when it fails or is too big to upload. */
async function toGif(mov: string) {
  if (!mov.startsWith('/')) return mov;
  const gif = mov.replace(/\.mov$/, '.gif');
  const palette = 'fps=30,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse';
  await run('ffmpeg', ['-v', 'error', '-y', '-i', mov, '-vf', palette, gif]);
  const size = statSync(gif, { throwIfNoEntry: false })?.size ?? 0;
  return size > GIF_LIMIT_BYTES ? `gif is ${Math.round(size / 1e6)} MB, over the 10 MB limit` : gif;
}

function buildApp() {
  const result = spawnSync('bash', [BUNDLE_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) return;
  return result.stdout.trim().split('\n').at(-1);
}

/** Seeds a scratch daemon, builds the app, and shoots the menu bar label, the window, a post, a muted room, folded and open presence runs, the jump pill, the New Room sheet, a standing room, a closed room, each Settings pane and the daemon-down state in light and dark. With `sidebar`, records the sidebar toggle instead. */
async function appShot({ home, port, sidebar }: { home: string; port: number; sidebar: boolean }) {
  const refused = checkShotHome(home);
  if (refused) return { code: 1, report: bad(refused) };
  rmSync(home, { force: true, recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  seedShotRooms({ dataDir: home, now: new Date() });

  const app = buildApp();
  if (!app) return { code: 1, report: bad('make app failed') };
  if (sidebar && !buildRecorder()) return { code: 1, report: bad('building the window recorder failed') };
  const daemon = await spawnDaemon({ detached: false, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };

  const env = { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(port) };
  const rows: string[][] = [];
  const launched: number[] = [];
  const before = appPids(app);
  try {
    if (sidebar) {
      const [[name = '', mov = ''] = []] = await shootAll({ app, env, launched, shots: [RECORDING] });
      rows.push([name, await toGif(mov)]);
    } else {
      spawnSync(path.join(app, 'Contents', 'MacOS', 'Messhall'), ['-renderStatus', OUT_DIR], { env });
      rows.push(
        ['menu-light', path.join(OUT_DIR, 'menu-light.png')],
        ['menu-dark', path.join(OUT_DIR, 'menu-dark.png')],
      );
      rows.push(...(await shootAll({ app, env, launched, shots: SHOTS })));
    }
  } finally {
    await daemon.stop();
  }
  if (!sidebar) rows.push(...(await shootAll({ app, env, launched, shots: DOWN_SHOTS })));
  const sized = rows.map(([name = '', file = '']) => {
    const size = file.startsWith('/')
      ? `${Math.round((statSync(file, { throwIfNoEntry: false })?.size ?? 0) / 1000)} kB`
      : '';
    return [name, file, size];
  });
  const failed = sized.filter(([, file, size]) => !file?.startsWith('/') || size === '0 kB');
  const left = leftoverApps({ isAlive: processAlive, kill: pid => process.kill(pid, 'SIGKILL'), launched });
  const strays = strayApps({ after: appPids(app), before });
  const table = formatTable(['shot', 'file', 'size'], sized);
  const verdict = failed.length ? bad(`${failed.length} shots failed`) : ok(`${sized.length} shots in ${OUT_DIR}`);
  const quit = left.length
    ? bad(`${left.length} launched apps did not quit and were killed: ${left.join(', ')}`)
    : ok(`all ${launched.length} launched apps quit`);
  const stray = strays.length
    ? bad(`apps from ${app} still running after the run: ${strays.join(', ')}`)
    : ok(`no app from ${app} left running`);
  const code = failed.length || left.length || strays.length ? 1 : 0;
  return { code, report: [table, '', verdict, quit, stray].join('\n') };
}

/** Registers `app-shot [--port <n>] [--home <dir>] [--sidebar]`. */
export function registerAppShot(program: Command) {
  program
    .command('app-shot')
    .description(
      'Seed a scratch daemon, build the Mac app and screenshot the menu bar, window, post, a muted room, jump pill, New Room sheet, standing and closed rooms, each Settings pane and daemon-down state in light and dark.',
    )
    .option('--port <port>', 'scratch daemon port', String(SHOT_PORT))
    .option('--home <dir>', 'scratch MESSHALL_HOME, wiped first', SHOT_HOME)
    .option('--sidebar', 'instead of the shots, record a human post and the sidebar hiding and showing, as a gif')
    .action(async (options: { home: string; port: string; sidebar?: boolean }) => {
      const result = await appShot({
        home: options.home,
        port: Number(options.port),
        sidebar: options.sidebar ?? false,
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
