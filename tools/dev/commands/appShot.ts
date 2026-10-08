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

import { APP_IDS } from './appBuilds.js';
import { spawnDaemon } from './daemon.js';

const SHOT_PORT = 7796;
const SHOT_HOME = '/tmp/messhall-tape-home-app';
const OUT_DIR = path.join(REPO_ROOT, 'demo', 'out', 'shots');
const BUNDLE_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'bundle.sh');
export const WINDOWS_SCRIPT = path.join(REPO_ROOT, 'app', 'scripts', 'windows.swift');
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
// A draft of four lines, so a shot shows where the send button sits once the box has grown.
const FOUR_LINES = [
  'ship it once the e2e run is green',
  'then tag the release',
  'and post the notes',
  'thanks both',
].join('\n');
const AGENT_POST = { as: 'editor', room: 'docs-sync', text: 'the glossary page is updated too' };

// The handoff shots go first, before the stale sweep drops the agents that left. Removed comes last, it changes the room.
const SHOTS = [
  { appearance: 'light', name: 'folded-light', room: 'handoff' },
  { appearance: 'dark', name: 'folded-dark', room: 'handoff' },
  { appearance: 'light', name: 'expanded-light', openFolds: true, room: 'handoff' },
  { appearance: 'dark', name: 'expanded-dark', openFolds: true, room: 'handoff' },
  { appearance: 'light', name: 'removed-light', openFolds: true, remove: 'docs', room: 'handoff' },
  { appearance: 'dark', name: 'removed-dark', openFolds: true, remove: 'web', room: 'handoff' },
  { appearance: 'light', name: 'window-light' },
  { appearance: 'dark', name: 'window-dark' },
  { appearance: 'light', name: 'post-light', post: true },
  { appearance: 'dark', name: 'post-dark' },
  { appearance: 'light', name: 'new-room-light', newRoom: 'Release Notes' },
  { appearance: 'dark', name: 'new-room-dark', newRoom: 'launch-week' },
  { appearance: 'light', name: 'welcome-light', welcome: true },
  { appearance: 'dark', name: 'welcome-dark', welcome: true },
  { appearance: 'light', name: 'standing-light', room: 'release-notes' },
  { appearance: 'dark', name: 'standing-dark', room: 'release-notes' },
  { appearance: 'light', name: 'closed-light', room: 'billing' },
  { appearance: 'dark', name: 'closed-dark', room: 'billing' },
  { agentPost: true, appearance: 'light', name: 'pill-light', room: 'docs-sync', scrollTop: true },
  { agentPost: true, appearance: 'dark', name: 'pill-dark', room: 'docs-sync', scrollTop: true },
  { appearance: 'light', muted: true, name: 'muted-light' },
  { appearance: 'dark', muted: true, name: 'muted-dark' },
  { agentPost: true, appearance: 'light', name: 'sidebar-light', room: 'checkout' },
  { agentPost: true, appearance: 'dark', name: 'sidebar-dark', room: 'checkout' },
  { appearance: 'light', name: 'human-row-light', room: 'docs-sync', scrollTop: true },
  { appearance: 'dark', name: 'human-row-dark', room: 'docs-sync', scrollTop: true },
  { appearance: 'light', name: 'empty-room-light', room: 'kickoff' },
  { appearance: 'dark', name: 'empty-room-dark', room: 'kickoff' },
  { appearance: 'light', draft: 'ship it once the e2e run is green', name: 'compose-light', room: 'checkout' },
  { appearance: 'dark', draft: 'ship it once the e2e run is green', name: 'compose-dark', room: 'checkout' },
  { appearance: 'light', draft: FOUR_LINES, name: 'compose-lines-light', room: 'checkout' },
  { appearance: 'dark', draft: FOUR_LINES, name: 'compose-lines-dark', room: 'checkout' },
  { appearance: 'light', draft: 'thanks @', name: 'picker-light', room: 'checkout' },
  { appearance: 'dark', draft: 'over to @a', name: 'picker-dark', room: 'checkout' },
  { appearance: 'light', keys: '@a|return', name: 'mention-pick-light', room: 'checkout' },
  { appearance: 'dark', keys: '@a|return|return', name: 'mention-only-dark', room: 'checkout' },
  {
    appearance: 'light',
    keys: 'line one|shift-return|line two|option-return|line three',
    name: 'shift-return-light',
    room: 'checkout',
  },
  {
    appearance: 'dark',
    keys: 'firstsecond|left|left|left|left|left|left|shift-return',
    name: 'shift-return-caret-dark',
    room: 'checkout',
  },
  { appearance: 'light', name: 'history-light', pageTop: true, room: 'history' },
  { appearance: 'dark', name: 'history-dark', pageTop: true, room: 'history' },
  { appearance: 'light', name: 'status-light', openFolds: true, room: 'checkout' },
  { appearance: 'dark', name: 'status-dark', openFolds: true, room: 'checkout' },
  { appearance: 'light', name: 'role-light', role: 'qa=reviewer', room: 'checkout' },
  { appearance: 'dark', name: 'role-dark', role: 'qa=reviewer', room: 'checkout' },
  { appearance: 'light', name: 'observer-light', openFolds: true, role: 'qa=observer', room: 'checkout' },
  { appearance: 'dark', name: 'observer-dark', openFolds: true, role: 'qa=observer', room: 'checkout' },
  { appearance: 'light', mute: 'qa', name: 'mute-light', openFolds: true, room: 'checkout' },
  { appearance: 'dark', mute: 'qa', name: 'mute-dark', openFolds: true, room: 'checkout' },
  { appearance: 'light', name: 'settings-appearance-light', settings: 'appearance' },
  { appearance: 'dark', name: 'settings-appearance-dark', settings: 'appearance' },
  { appearance: 'light', name: 'settings-avatars-light', settings: 'avatars' },
  { appearance: 'dark', name: 'settings-avatars-dark', settings: 'avatars' },
  { appearance: 'light', name: 'settings-notifications-light', settings: 'notifications' },
  { appearance: 'dark', name: 'settings-notifications-dark', settings: 'notifications' },
  { appearance: 'light', name: 'settings-shortcut-light', settings: 'shortcut' },
  { appearance: 'dark', name: 'settings-shortcut-dark', settings: 'shortcut' },
  { appearance: 'light', menuOpen: true, name: 'menu-open-light' },
  { appearance: 'dark', menuOpen: true, name: 'menu-open-dark' },
  { appearance: 'light', hotkey: true, name: 'hotkey-light' },
  { appearance: 'light', name: 'notify-blocked-light', notify: 'denied' },
  { appearance: 'dark', name: 'notify-blocked-dark', notify: 'denied' },
  { appearance: 'light', name: 'settings-notify-blocked-light', notify: 'denied', settings: 'notifications' },
  { appearance: 'dark', name: 'settings-notify-asked-dark', notify: 'notAsked', settings: 'notifications' },
  { appearance: 'light', name: 'pr-cards-light', pullRequests: true, room: 'reviews' },
  { appearance: 'dark', name: 'pr-cards-dark', pullRequests: true, room: 'reviews' },
  { appearance: 'light', name: 'ask-light', room: 'deploy' },
  { appearance: 'dark', name: 'ask-dark', room: 'deploy' },
  { appearance: 'light', name: 'ask-long-light', room: 'release' },
  { appearance: 'dark', name: 'ask-long-dark', room: 'release' },
  { appearance: 'light', name: 'question-light', room: 'launch' },
  { appearance: 'dark', name: 'question-dark', room: 'launch' },
  { appearance: 'light', name: 'agreements-light', room: 'contract' },
  { appearance: 'dark', name: 'agreements-dark', room: 'contract' },
  { agents: true, appearance: 'light', name: 'agents-light', pullRequests: true, room: 'launch' },
  { agents: true, appearance: 'dark', name: 'agents-dark', openFolds: true, pullRequests: true, room: 'launch' },
  {
    agents: true,
    appearance: 'light',
    name: 'agents-still-light',
    pullRequests: true,
    reduceMotion: true,
    room: 'launch',
  },
  { appearance: 'light', name: 'sidebar-collapsed-light', sidebarCollapsed: true },
  { appearance: 'dark', name: 'sidebar-collapsed-dark', sidebarCollapsed: true },
  { appearance: 'light', name: 'narrow-light', width: 720 },
  { appearance: 'dark', name: 'narrow-dark', width: 720 },
  { appearance: 'light', glyph: 0, name: 'glyph-0-light', room: 'launch' },
  { appearance: 'light', glyph: 3, name: 'glyph-3-light', room: 'launch' },
  { appearance: 'light', contract: 0, name: 'older-light', room: 'checkout' },
  { appearance: 'dark', contract: 0, name: 'older-dark', room: 'checkout' },
  { appearance: 'light', contract: 99, name: 'daemon-older-light', room: 'checkout' },
  { appearance: 'dark', contract: 99, name: 'daemon-older-dark', room: 'checkout' },
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
  shortcut: { hotkey: { key: 'K', modifiers: 'controlCommand' } },
} as const;
// Keys the real app never holds, so the shot app can take them for its one press.
const SHOT_HOTKEY = { hotkey: { key: '9', modifiers: 'controlOptionCommand' } };
// Shot after the daemon stops, so the window shows its empty state.
const DOWN_SHOTS = [
  { appearance: 'light', name: 'down-light' },
  { appearance: 'dark', name: 'down-dark' },
] as const;

const check = (conclusion: string) => ({ __typename: 'CheckRun', conclusion, status: 'COMPLETED' });
/** What `gh pr view --json` answers for each PR the reviews room links. A link left out reads as unreadable. */
export const PULL_REQUEST_ANSWERS = {
  'https://github.com/acme/shop/pull/41': {
    isDraft: false,
    labels: [],
    state: 'OPEN',
    statusCheckRollup: [check('SUCCESS'), check('SUCCESS')],
    title: 'Store order totals in minor units',
  },
  'https://github.com/acme/shop/pull/42': {
    isDraft: false,
    labels: [{ color: 'B60205', name: 'human veto' }],
    state: 'OPEN',
    statusCheckRollup: [check('SUCCESS'), check('FAILURE')],
    title: 'Check the agent key once per request',
  },
  'https://github.com/acme/shop/pull/43': {
    isDraft: true,
    labels: [
      { color: 'fbca04', name: 'app' },
      { color: '0052cc', name: 'payments' },
      { color: 'c5def5', name: 'needs design' },
      { color: 'd73a4a', name: 'bug' },
      { color: 'ededed', name: 'wontfix' },
    ],
    state: 'OPEN',
    statusCheckRollup: [{ __typename: 'CheckRun', conclusion: '', status: 'IN_PROGRESS' }],
    title: 'Refund flow',
  },
  'https://github.com/acme/shop/pull/44': {
    isDraft: false,
    labels: [{ color: 'ededed', name: 'wontfix' }],
    state: 'CLOSED',
    statusCheckRollup: [],
    title: 'Round totals in the browser',
  },
  'https://github.com/acme/web/pull/38': {
    isDraft: false,
    labels: [],
    state: 'MERGED',
    statusCheckRollup: [check('SUCCESS')],
    title: 'Format prices from minor units',
  },
} as const;

const QUIT_WITHIN_MS = 5000;
// The window's own layer (0, or 3 once floated for a recording), never the menu bar label's 25.
const WINDOW_LAYERS = [0, 3];
/** The layer an open menu bar menu draws on. */
export const MENU_LAYERS = [101];

const run = promisify(execFile);
const CLAUDE = { name: 'claude-code', version: '2.1.289' };
// Enough lines in docs-sync that its transcript scrolls, for the jump pill shot.
const CHANGELOG_PAGES = Array.from({ length: 24 }, (_, i) => `api reference part ${i + 1}`);
// More posts than the snapshot's last 50, so scrolling to the top pages older ones in.
const HISTORY_POSTS = 120;
const HISTORY_TASKS = ['read the plan', 'wrote the test', 'ran the suite', 'fixed the lint', 'opened the diff'];

/** The id of the largest window on one of `layers` in a `windows.swift` listing, by default the app's main window. */
export function pickWindow(listing: string, layers = WINDOW_LAYERS) {
  const windows = listing
    .trim()
    .split('\n')
    .map(line => {
      const [id = 0, layer, width = 0, height = 0] = line.split(' ').map(Number);
      return { area: width * height, id, layer };
    })
    .filter(window => layers.includes(window.layer ?? -1) && window.area > 0);
  return windows.toSorted((a, b) => b.area - a.area)[0]?.id;
}

/** Why `home` cannot hold the shot's scratch rooms, or undefined when it can. */
export function checkShotHome(home: string) {
  const real = path.join(homedir(), 'Library', 'Application Support', 'messhall');
  if (path.resolve(home) === real) return `refusing ${home}, it is the real data dir`;
}

/** A room with runs of joins and leaves between posts, so the transcript shows folded and open runs. It ends with two agents left and two away, for the away chip. */
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
    ['design', 'join'],
    ['docs', 'join'],
    ['web', 'join'],
    ['qa', 'join'],
  ]);
  store.postMessage({ from: 'api', room, text: '@web i will take the migration, the form is yours' });
  store.postMessage({ from: 'web', room, text: '@api sounds good, starting on the form now' });
  presence([
    ['web', 'leave', 'back after lunch'],
    ['qa', 'leave'],
  ]);
  store.postMessage({ from: 'human', room, text: 'how we doing, whats in progress' });
  presence([
    ['web', 'join'],
    ['qa', 'join'],
  ]);
  store.postMessage({ from: 'api', room, text: '@web @qa the migration is in, over to you' });
  presence([
    ['web', 'leave'],
    ['qa', 'leave'],
  ]);
  ['design', 'docs'].forEach(as => store.touch({ as, room, state: 'away' }));
}

/** A room whose lines link PRs: open and passing, merged, failing with the human veto label, a draft with five labels, a closed one, and one gh cannot read. */
function seedReviews({ step, store }: { step: (ms: number) => void; store: RoomStore }) {
  const room = 'reviews';
  const [open, failing, draft, closed, merged] = [
    'shop/pull/41',
    'shop/pull/42',
    'shop/pull/43',
    'shop/pull/44',
    'web/pull/38',
  ].map(pr => `https://github.com/acme/${pr}`);
  ['api', 'web', 'reviewer'].forEach(as => store.joinRoom({ as, client: CLAUDE, kind: 'claude', room }));
  const unreadable = 'https://github.com/acme/docs/pull/7';
  const lines: [string, string][] = [
    ['api', `ready for review: ${open} @reviewer`],
    ['web', `merged: ${merged}, prices read minor units now`],
    ['web', `the docs change is ${unreadable}, gh cannot see that repo so it stays a plain link`],
    ['api', `ci is red on ${failing}, it touches the key check so it waits for @human`],
    ['web', `closed ${closed}, the api rounds now`],
    ['reviewer', `where we are: ${draft} ${open} ${merged} ${failing} ${unreadable}`],
  ];
  lines.forEach(([from, text]) => {
    step(10_000);
    store.postMessage({ from, room, text });
  });
}

/** A room longer than the snapshot, two agents taking turns on numbered steps. */
function seedHistory({ step, store }: { step: (ms: number) => void; store: RoomStore }) {
  const room = 'history';
  store.joinRoom({ as: 'planner', client: CLAUDE, kind: 'claude', room });
  Array.from({ length: HISTORY_POSTS }, (_, i) => {
    step(5_000);
    if (i === 1) store.joinRoom({ as: 'builder', client: CLAUDE, kind: 'claude', room });
    const task = HISTORY_TASKS[i % HISTORY_TASKS.length];
    const from = i % 2 ? 'builder' : 'planner';
    return store.postMessage({ from, room, text: `step ${i + 1} of ${HISTORY_POSTS}: ${task}` });
  });
}

/** Seeds seven rooms on a fresh db so every screen has something to show. Presence follows `now`. */
export function seedShotRooms({ dataDir, now }: { dataDir: string; now: Date }) {
  let at = now.getTime() - 20 * 60_000;
  const db = openDb({ dataDir });
  const store = createRoomStore({ db, now: () => new Date(at) });
  const step = (ms: number) => {
    at += ms;
  };
  try {
    at -= 20 * 60_000;
    seedHistory({ step, store });
    seedReviews({ step, store });
    at = now.getTime() - 20 * 60_000;
    store.joinRoom({ as: 'writer', kind: 'codex', room: 'docs-sync' });
    store.postMessage({ from: 'writer', room: 'docs-sync', text: 'drafting the changelog for the currency change' });
    CHANGELOG_PAGES.forEach((page, i) => {
      step(10_000);
      store.postMessage({ from: 'writer', room: 'docs-sync', text: `updated the ${page} page for minor units` });
      if (i === 4) store.postMessage({ from: 'human', room: 'docs-sync', text: 'looks good so far, keep going' });
    });
    step(5 * 60_000);
    store.joinRoom({ as: 'ledger', client: CLAUDE, kind: 'claude', room: 'billing' });
    store.postMessage({ done: true, from: 'ledger', room: 'billing', text: 'invoices backfilled' });
    store.joinRoom({ as: 'qa', client: { name: 'opencode', version: '1.18.34' }, kind: 'other', room: 'checkout' });
    store.postMessage({
      from: 'qa',
      room: 'checkout',
      text: '@all i will rerun the checkout e2e once both sides land',
    });
    // Left and away agents land late, so the 5 minute stale sweep keeps them through the shots.
    at = now.getTime() - 5 * 60_000;
    seedHandoff({ step, store });
    step(10_000);
    store.joinRoom({ as: 'ci', client: { name: 'messhall-cli', version: '0.1.0' }, kind: 'other', room: 'checkout' });
    store.postMessage({ from: 'ci', room: 'checkout', text: 'nightly e2e on main is green' });
    store.leaveRoom({ as: 'ci', room: 'checkout' });
    at = now.getTime() - 3 * 60_000;
    store.joinRoom({ as: 'api', client: CLAUDE, kind: 'claude', room: 'checkout' });
    store.setStatus({ as: 'api', room: 'checkout', status: 'waiting on the qa e2e run' });
    at = now.getTime() - 60_000;
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
    store.setStatus({ as: 'web', room: 'checkout', status: 'tests green, PR open, CI running' });
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
    store.createRoom({ created_by: 'human', name: 'kickoff' });
    store.joinRoom({ as: 'deployer', client: CLAUDE, kind: 'claude', room: 'deploy' });
    store.postMessage({ from: 'deployer', room: 'deploy', text: 'migration is ready, running it on staging next' });
    store.sweepPresence({ ringable: () => false });
  } finally {
    db.close();
  }
}

// Harmless first lines and the real step at the end, so the shot proves the card shows the whole call.
const LONG_ASK = [
  '{ "command": "set -e',
  'pnpm install --frozen-lockfile',
  'pnpm build',
  'pnpm test',
  'git tag v2.0.0',
  'git push origin v2.0.0',
  'git push --force origin main',
  'npm publish --access public" }',
].join('\n');

/** Brings the deploy agent back and adds its pending tool ask, plus a long one in #release, two questions in #launch and agreements in #contract. Runs after the daemon starts, since its start marks
 * every agent reconnecting and expires every pending ask. */
export function seedShotAsk({ dataDir, now }: { dataDir: string; now: Date }) {
  const db = openDb({ dataDir });
  try {
    const store = createRoomStore({ db, now: () => now });
    store.touch({ as: 'deployer', room: 'deploy', state: 'active' });
    store.openApproval({
      description: 'Run the staging migration',
      inputPreview: '{"command": "pnpm db:migrate --env staging"}',
      requestId: 'abcde',
      seats: [{ name: 'deployer', room: 'deploy' }],
      session: 'shot',
      tool: 'Bash',
    });
    store.joinRoom({ as: 'shipper', client: CLAUDE, kind: 'claude', room: 'release' });
    store.openApproval({
      description: 'Tag and publish the release',
      inputPreview: LONG_ASK,
      requestId: 'fghij',
      seats: [{ name: 'shipper', room: 'release' }],
      session: 'shot-long',
      tool: 'Bash',
    });
    store.joinRoom({ as: 'api', client: CLAUDE, kind: 'claude', room: 'launch' });
    store.joinRoom({ as: 'web', client: CLAUDE, kind: 'claude', room: 'launch' });
    store.setStatus({ as: 'api', room: 'launch', status: 'staging green on https://github.com/acme/shop/pull/41' });
    store.setStatus({ as: 'deployer', room: 'deploy', status: 'waiting for the go to migrate staging' });
    store.touch({ as: 'reviewer', room: 'reviews', state: 'active' });
    store.setStatus({ as: 'reviewer', room: 'reviews', status: 'reading the rounding diff' });
    store.askQuestion({
      as: 'api',
      options: ['ship it', 'wait for review'],
      question: 'the cents migration is green on staging. merge it today?',
      room: 'launch',
    });
    store.askQuestion({
      as: 'web',
      options: ['banner', 'modal', 'inline note', 'skip it'],
      question: 'how should checkout tell people prices moved to cents?',
      room: 'launch',
    });
    ['api', 'web', 'mobile'].forEach(as => store.joinRoom({ as, client: CLAUDE, kind: 'claude', room: 'contract' }));
    const cents = store.proposeAgreement({
      as: 'api',
      room: 'contract',
      text: 'order totals move to amount_minor, integer cents, with a 3 letter currency beside it',
      with: ['web', 'mobile'],
    });
    if (cents.ok) {
      ['web', 'mobile'].forEach(as => store.confirmAgreement({ as, id: cents.agreement.id, room: 'contract' }));
    }
    const refunds = store.proposeAgreement({
      as: 'web',
      room: 'contract',
      text: 'refunds carry amount_minor too, api ships first and web adapts the formatter after',
      with: ['api', 'mobile'],
    });
    if (refunds.ok) store.confirmAgreement({ as: 'api', id: refunds.agreement.id, room: 'contract' });
  } finally {
    db.close();
  }
}

/** The shots named in a comma list, in table order, or every shot when no list is given. */
export function pickShots(only?: string) {
  if (only === undefined) return { ok: true, shots: SHOTS } as const;
  const names = only.split(',').map(name => name.trim());
  const unknown = names.filter(name => !SHOTS.some(shot => shot.name === name));
  if (unknown.length) return { ok: false, unknown } as const;
  return { ok: true, shots: SHOTS.filter(shot => names.includes(shot.name)) } as const;
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
const anchorFile = (shot: Shot) => path.join(OUT_DIR, `${shot.name}.anchor`);
const hotkeyFile = (shot: Shot) => path.join(OUT_DIR, `${shot.name}.hotkey`);
const keysFile = (shot: Shot) => path.join(OUT_DIR, `${shot.name}.keys`);

/** The file a shot's app writes a note into, printed under the table. */
function noteFile(shot: Shot) {
  if ('pageTop' in shot) return anchorFile(shot);
  if ('hotkey' in shot) return hotkeyFile(shot);
  if ('keys' in shot) return keysFile(shot);
}

/** Waits for the app to write a sheet shot. Gives an error text when none lands in time. */
async function waitFile(file: string, deadline = Date.now() + WINDOW_WITHIN_MS): Promise<string | undefined> {
  if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 0) return;
  if (Date.now() > deadline) return `no sheet drawn within ${WINDOW_WITHIN_MS}ms`;
  await sleep(250);
  return waitFile(file, deadline);
}

// AppKit saves these on every resize or collapse, and the shot app shares one bundle id across launches.
const SAVED_LAYOUT = ['NSWindow Frame main', 'NSSplitView Subview Frames main, SidebarNavigationSplitView'];

/** The `defaults` calls that forget the window frame and sidebar the last shot app saved. None for the real app. */
export function layoutResets(bundleId: string) {
  // A main checkout build shares the human's own app id, so its saved layout is the human's.
  if (bundleId === APP_IDS[0]) return [];
  return SAVED_LAYOUT.map(key => ['delete', bundleId, key]);
}

/** Forgets the window frame and sidebar the last app from this build saved, so the next one opens on screen. */
export function forgetLayout(app: string) {
  const bundleId = spawnSync('defaults', ['read', path.join(app, 'Contents', 'Info'), 'CFBundleIdentifier'], {
    encoding: 'utf8',
  }).stdout.trim();
  layoutResets(bundleId).forEach(args => spawnSync('defaults', args, { stdio: 'ignore' }));
}

/** The launch args for one shot. The real app may share the bundle id, so a window closed there would stay shut here. */
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
        ...('hotkey' in shot ? SHOT_HOTKEY : {}),
      }),
    ),
    ...('settings' in shot ? ['-shotSettings', windowFile(shot)] : []),
    ...('room' in shot ? ['-shotRoom', shot.room] : []),
    ...('role' in shot ? ['-shotRole', shot.role] : []),
    ...('remove' in shot ? ['-shotRemove', shot.remove] : []),
    ...('mute' in shot ? ['-shotMute', shot.mute] : []),
    ...('newRoom' in shot ? ['-shotNewRoom', shot.newRoom, '-shotSheet', shotFile(shot)] : []),
    ...('welcome' in shot ? ['-shotWelcome', 'YES', '-shotSheet', shotFile(shot)] : []),
    ...('scrollTop' in shot ? ['-shotScrollTop', 'YES'] : []),
    ...('openFolds' in shot ? ['-shotOpenFolds', 'YES'] : []),
    ...('draft' in shot ? ['-shotDraft', shot.draft] : []),
    ...('keys' in shot ? ['-shotKeys', shot.keys, '-shotKeysOut', keysFile(shot)] : []),
    ...('pageTop' in shot ? ['-shotPageTop', anchorFile(shot)] : []),
    ...('toggleSidebar' in shot ? ['-shotToggleSidebar', String(TOGGLE_PAUSE_S)] : []),
    ...('menuOpen' in shot ? ['-shotMenu', 'YES'] : []),
    ...('hotkey' in shot ? ['-shotHotkey', hotkeyFile(shot)] : []),
    ...('contract' in shot ? ['-shotContract', String(shot.contract)] : []),
    ...('notify' in shot ? ['-shotNotify', shot.notify] : []),
    ...('agents' in shot ? ['-shotAgents', 'YES'] : []),
    ...('sidebarCollapsed' in shot ? ['-shotSidebarCollapsed', 'YES'] : []),
    ...('width' in shot ? ['-shotWidth', String(shot.width)] : []),
    ...('glyph' in shot ? ['-shotGlyph', String(shot.glyph)] : []),
    ...('reduceMotion' in shot ? ['-shotReduceMotion', 'YES'] : []),
    ...('pullRequests' in shot ? ['-shotPullRequests', JSON.stringify(JSON.stringify(PULL_REQUEST_ANSWERS))] : []),
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
export function appPids(app: string) {
  const result = spawnSync('pgrep', ['-f', path.join(app, 'Contents', 'MacOS', 'Messhall')], { encoding: 'utf8' });
  return result.stdout.split('\n').filter(Boolean).map(Number);
}

/** The Settings window's number, which the app writes once Settings is up, or an error text. */
async function settingsWindow(shot: Shot) {
  const file = windowFile(shot);
  return (await waitFile(file)) ?? readFileSync(file, 'utf8').trim();
}

/** The app's main window number once it draws one, or undefined after 30 s. */
export async function waitWindow(
  pid: number,
  layers = WINDOW_LAYERS,
  deadline = Date.now() + WINDOW_WITHIN_MS,
): Promise<number | undefined> {
  const { stdout } = await run('swift', [WINDOWS_SCRIPT, String(pid)]);
  const id = pickWindow(stdout, layers);
  if (id !== undefined || Date.now() > deadline) return id;
  await sleep(500);
  return waitWindow(pid, layers, deadline);
}

/** The window number screencapture takes: Settings, the open menu, the window opened again by the hotkey, or the main one. */
async function shotTarget({ id, pid, shot }: { id: number; pid: number; shot: Shot }) {
  if ('settings' in shot) return settingsWindow(shot);
  if ('menuOpen' in shot) return String((await waitWindow(pid, MENU_LAYERS)) ?? 'no menu opened');
  if ('hotkey' in shot) return String((await waitWindow(pid)) ?? 'no window after the hotkey');
  return String(id);
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
  rmSync(anchorFile(shot), { force: true });
  rmSync(hotkeyFile(shot), { force: true });
  rmSync(keysFile(shot), { force: true });
  forgetLayout(app);
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
    if ('newRoom' in shot || 'welcome' in shot) return (await waitFile(file)) ?? file;
    await sleep(SETTLE_MS);
    if ('pageTop' in shot) {
      const missing = await waitFile(anchorFile(shot));
      if (missing) return `no older page landed: ${missing}`;
    }
    if ('hotkey' in shot) {
      const missing = await waitFile(hotkeyFile(shot));
      if (missing) return `no hotkey press logged: ${missing}`;
    }
    if ('keys' in shot) {
      const missing = await waitFile(keysFile(shot));
      if (missing) return `no key presses logged: ${missing}`;
    }
    const target = await shotTarget({ id, pid: child.pid ?? 0, shot });
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

/** Runs `app/scripts/bundle.sh` and gives the app path, or undefined when the build fails. */
export function buildApp() {
  const result = spawnSync('bash', [BUNDLE_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) return;
  return result.stdout.trim().split('\n').at(-1);
}

/** Seeds a scratch daemon, builds the app, and shoots the menu bar label and its open menu, the window opened again by the hotkey, the window, a post, a muted room, folded and open presence runs, the jump pill, the mention picker, Return in the picker and on a mention-only draft, Shift Return making a new line at the end and mid-draft, the New Room sheet, a standing room, a closed room, PR cards, each Settings pane, a tool ask card, the older-app notice, the blocked-notifications notice and the daemon-down state in light and dark. With `only`, just the named shots. With `sidebar`, records the sidebar toggle instead. */
async function appShot({ home, only, port, sidebar }: { home: string; only?: string; port: number; sidebar: boolean }) {
  const refused = checkShotHome(home);
  if (refused) return { code: 1, report: bad(refused) };
  const picked = pickShots(only);
  if (!picked.ok) return { code: 1, report: bad(`no shot named ${picked.unknown.join(', ')}`) };
  rmSync(home, { force: true, recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  seedShotRooms({ dataDir: home, now: new Date() });

  const app = buildApp();
  if (!app) return { code: 1, report: bad('make app failed') };
  if (sidebar && !buildRecorder()) return { code: 1, report: bad('building the window recorder failed') };
  const daemon = await spawnDaemon({ detached: false, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  seedShotAsk({ dataDir: home, now: new Date() });

  const env = { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(port) };
  const rows: string[][] = [];
  const launched: number[] = [];
  const before = appPids(app);
  try {
    if (sidebar) {
      const [[name = '', mov = ''] = []] = await shootAll({ app, env, launched, shots: [RECORDING] });
      rows.push([name, await toGif(mov)]);
    } else {
      if (only === undefined) {
        spawnSync(path.join(app, 'Contents', 'MacOS', 'Messhall'), ['-renderStatus', OUT_DIR], { env });
        rows.push(
          ['menu-light', path.join(OUT_DIR, 'menu-light.png')],
          ['menu-dark', path.join(OUT_DIR, 'menu-dark.png')],
        );
      }
      rows.push(...(await shootAll({ app, env, launched, shots: picked.shots })));
    }
  } finally {
    await daemon.stop();
  }
  if (!sidebar && only === undefined) rows.push(...(await shootAll({ app, env, launched, shots: DOWN_SHOTS })));
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
  const anchors = SHOTS.flatMap(shot => {
    const file = noteFile(shot);
    const note = file && statSync(file, { throwIfNoEntry: false }) && readFileSync(file, 'utf8');
    return note ? [`${shot.name}: ${note.trim()}`] : [];
  });
  return { code, report: [table, '', ...anchors, verdict, quit, stray].join('\n') };
}

/** Registers `app-shot [--port <n>] [--home <dir>] [--sidebar] [--only <names>]`. */
export function registerAppShot(program: Command) {
  program
    .command('app-shot')
    .description(
      'Seed a scratch daemon, build the Mac app and screenshot the menu bar and its open menu, the hotkey, window, post, a muted room, jump pill, mention picker and Return on it, Shift Return, New Room sheet, standing and closed rooms, PR cards, each Settings pane, older-app and blocked-notifications notices and daemon-down state in light and dark.',
    )
    .option('--port <port>', 'scratch daemon port', String(SHOT_PORT))
    .option('--home <dir>', 'scratch MESSHALL_HOME, wiped first', SHOT_HOME)
    .option('--sidebar', 'instead of the shots, record a human post and the sidebar hiding and showing, as a gif')
    .option('--only <names>', 'only these shots, a comma list like ask-light,ask-dark')
    .action(async (options: { home: string; only?: string; port: string; sidebar?: boolean }) => {
      const result = await appShot({
        home: options.home,
        only: options.only,
        port: Number(options.port),
        sidebar: options.sidebar ?? false,
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
