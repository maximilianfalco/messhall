import type { Daemon } from '../../src/daemon/server.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import { CLI_VERSION, DB_FILE, SWEEP_EVERY_MS } from '../../src/config.js';
import { currentBuild } from '../../src/daemon/build.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { wakeText } from '../../src/doorbell/wake.js';
import { SEAT_HEADER, SERVER_NAME } from '../../src/mcp/constants.js';
import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';

import { get } from './http.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');

let home: string;
let at: number;
let daemon: Daemon | undefined;
const now = () => new Date(at);

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-daemon-'));
  at = T0;
  vi.stubEnv('MESSHALL_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

async function start(tmux?: Parameters<typeof startDaemon>[0]['tmux']) {
  const started = await startDaemon({ dataDir: home, now, port: 0, tmux });
  if (!started.ok) throw new Error(`daemon did not start: ${started.reason}`);
  daemon = started.daemon;
  return started.daemon;
}

function sideStore() {
  const db = openDb({ dataDir: home });
  return { db, store: createRoomStore({ db, now }) };
}

describe('startDaemon', () => {
  it('answers /health with version, build, contract, uptime, rooms and live members', async () => {
    const { port } = await start();
    const side = sideStore();
    side.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    side.store.joinRoom({ as: 'web', kind: 'codex', room: 'demo' });
    side.store.leaveRoom({ as: 'web', room: 'demo' });
    side.db.close();
    at += 5_000;

    const res = await get({ path: '/health', port });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toStrictEqual({
      build: currentBuild(),
      contract_version: FEED_CONTRACT_VERSION,
      live_members: 1,
      ok: true,
      rooms: 1,
      uptime_s: 5,
      version: CLI_VERSION,
    });
  });

  it('answers 404 for any other path', async () => {
    const { port } = await start();

    const res = await get({ path: '/rooms', port });

    expect(res.status).toBe(404);
  });

  it.each(['127.0.0.1', 'localhost', '127.0.0.1:{port}', 'localhost:{port}'])('lets Host %s through', async host => {
    const { port } = await start();

    const res = await get({ headers: { host: host.replace('{port}', String(port)) }, path: '/health', port });

    expect(res.status).toBe(200);
  });

  it.each(['evil.example', 'evil.example:{port}', '127.0.0.1.evil.example', 'localhost:1'])(
    'refuses Host %s with 403',
    async host => {
      const { port } = await start();

      const res = await get({ headers: { host: host.replace('{port}', String(port)) }, path: '/health', port });

      expect(res.status).toBe(403);
    },
  );

  it.each(['https://evil.example', 'http://localhost:{port}', 'null'])(
    'refuses any Origin, here %s, with 403',
    async origin => {
      const { port } = await start();

      const res = await get({ headers: { origin: origin.replace('{port}', String(port)) }, path: '/health', port });

      expect(res.status).toBe(403);
    },
  );

  it('refuses a foreign Host on a path that has no route', async () => {
    const { port } = await start();

    const res = await get({ headers: { host: 'evil.example' }, path: '/nothing', port });

    expect(res.status).toBe(403);
  });

  it('mounts the feed behind the guard and the keys', async () => {
    const { port } = await start();
    const key = readFileSync(path.join(home, KEY_FILES.human), 'utf8');

    const [open, keyless, browser] = await Promise.all([
      get({ headers: { [KEY_HEADER]: key }, path: '/api/snapshot', port }),
      get({ path: '/api/snapshot', port }),
      get({ headers: { [KEY_HEADER]: key, origin: 'https://evil.example' }, path: '/api/snapshot', port }),
    ]);

    expect([open.status, keyless.status, browser.status]).toStrictEqual([200, 401, 403]);
    expect(JSON.parse(open.body)).toStrictEqual({
      build: currentBuild(),
      contract_version: FEED_CONTRACT_VERSION,
      rooms: [],
      seq: 0,
      version: CLI_VERSION,
    });
  });

  it('marks members from the last run reconnecting on start, since their sessions died with it', async () => {
    const before = sideStore();
    before.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    before.db.close();

    await start();

    const side = sideStore();
    expect(side.store.listMembers('demo').find(member => member.name === 'api')?.presence).toBe('reconnecting');
    side.db.close();
  });

  it('wakes a spawned claude that sat in a room before the restart through its tmux pane', async () => {
    const before = sideStore();
    before.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-api' });
    before.db.close();
    const config = path.join(home, 'spawn', 'demo_api-mcp.json');
    mkdirSync(path.dirname(config));
    writeFileSync(
      config,
      JSON.stringify({ mcpServers: { [SERVER_NAME]: { headers: { [SEAT_HEADER]: 'seat-api' } } } }),
    );
    const sent: string[][] = [];
    const tmux = (args: string[]) => {
      if (args[0] === 'send-keys') sent.push(args);
      const stdout = args[0] === 'list-panes' ? `messhall_demo_api:claude --mcp-config '${config}'` : '';
      if (args[0] === 'display-message') return Promise.resolve({ code: 0, stderr: '', stdout: '✳ Claude Code\n' });
      return Promise.resolve({ code: 0, stderr: '', stdout });
    };

    await start(tmux);

    await vi.waitFor(() =>
      expect(sent).toContainEqual(['send-keys', '-t', '=messhall_demo_api:', '-l', wakeText(['demo'])]),
    );
  });

  it('sweeps presence on its interval with its own clock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await start();
    const side = sideStore();
    side.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    at += 3 * 60_000;

    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    expect(side.store.listMembers('demo').find(member => member.name === 'api')?.presence).toBe('idle');
    side.db.close();
  });

  it('drops members left for 5 minutes on the same sweep', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await start();
    const side = sideStore();
    side.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    side.store.leaveRoom({ as: 'api', room: 'demo' });
    at += 5 * 60_000;

    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    expect(side.store.listMembers('demo', { left: true }).map(member => member.name)).toStrictEqual(['human']);
    side.db.close();
  });

  it('makes a done seat away for an hour leave on the same sweep and stops its session', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const tmux = vi.fn<NonNullable<Parameters<typeof startDaemon>[0]['tmux']>>(() =>
      Promise.resolve({ code: 0, stderr: '', stdout: '' }),
    );
    await start(tmux);
    const side = sideStore();
    side.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    side.store.joinRoom({ as: 'web', kind: 'claude', room: 'demo' });
    side.store.postMessage({ done: true, from: 'api', room: 'demo', text: 'merged' });
    at += 61 * 60_000;

    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    expect(side.store.listMembers('demo', { left: true }).find(member => member.name === 'api')?.presence).toBe('left');
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', '=messhall_demo_api:']);
    side.db.close();
  });

  it('restarts a spawned seat whose tmux session died, on the sweep', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cwd = mkdtempSync(path.join(tmpdir(), 'messhall-heal-cwd-'));
    const live = new Set(['messhall_demo_api']);
    const tmux = vi.fn<NonNullable<Parameters<typeof startDaemon>[0]['tmux']>>(args => {
      const stdout = args[0] === 'list-sessions' ? [...live].join('\n') : 'Select login method:';
      return Promise.resolve({ code: 0, stderr: '', stdout });
    });
    await start(tmux);
    const side = sideStore();
    side.store.createRoom({ created_by: 'human', name: 'demo' });
    const invited = side.store.invite({
      by: 'human',
      launch: { agent: 'claude', cwd },
      name: 'api',
      role: 'worker',
      room: 'demo',
    });
    if (!invited.ok) throw new Error(invited.reason);
    side.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: invited.seatKey });

    vi.advanceTimersByTime(SWEEP_EVERY_MS);
    await vi.waitFor(() => expect(tmux).toHaveBeenCalledWith(['list-sessions', '-F', '#{session_name}']));
    live.clear();
    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    await vi.waitFor(() => expect(tmux.mock.calls.some(([args]) => args[0] === 'new-session')).toBe(true));
    await vi.waitFor(() => expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', '=messhall_demo_api:']));
    side.db.close();
    rmSync(cwd, { force: true, recursive: true });
  });

  it('logs nothing from a heal still waiting on tmux when close shuts the db', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const listing = Promise.withResolvers<{ code: number; stderr: string; stdout: string }>();
    const tmux = vi.fn<NonNullable<Parameters<typeof startDaemon>[0]['tmux']>>(args =>
      args[0] === 'list-sessions' ? listing.promise : Promise.resolve({ code: 0, stderr: '', stdout: '' }),
    );
    const running = await start(tmux);
    vi.advanceTimersByTime(SWEEP_EVERY_MS);
    await vi.waitFor(() => expect(tmux).toHaveBeenCalledWith(['list-sessions', '-F', '#{session_name}']));

    await running.close();
    daemon = undefined;
    listing.resolve({ code: 0, stderr: '', stdout: '' });
    await sleep(20);

    expect(String(vi.mocked(process.stderr.write).mock.calls)).not.toContain('healing seats failed');
  });

  it('drops an invite unused for 10 minutes on the same sweep', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await start();
    const side = sideStore();
    side.store.createRoom({ created_by: 'human', name: 'demo' });
    side.store.invite({
      by: 'human',
      launch: { agent: 'claude', cwd: home },
      name: 'api',
      role: 'worker',
      room: 'demo',
    });
    at += 10 * 60_000;

    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    expect(side.store.listMembers('demo').map(member => member.name)).toStrictEqual(['human']);
    side.db.close();
  });

  it('reports the pid that holds a taken port', async () => {
    const holder = createServer();
    await new Promise<void>(resolve => {
      holder.listen(0, '127.0.0.1', resolve);
    });
    const address = holder.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const started = await startDaemon({ dataDir: home, findPortHolder: () => Promise.resolve('4242'), now, port });

    expect(started).toStrictEqual({ ok: false, pid: '4242', port, reason: 'port_taken' });
    expect(existsSync(path.join(home, DB_FILE))).toBe(false);
    await new Promise(resolve => {
      holder.close(resolve);
    });
  });
});
