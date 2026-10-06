import type { Daemon } from '../../src/daemon/server.js';

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import { CLI_VERSION, DB_FILE, SWEEP_EVERY_MS } from '../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
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

async function start() {
  const started = await startDaemon({ dataDir: home, now, port: 0 });
  if (!started.ok) throw new Error(`daemon did not start: ${started.reason}`);
  daemon = started.daemon;
  return started.daemon;
}

function sideStore() {
  const db = openDb({ dataDir: home });
  return { db, store: createRoomStore({ db, now }) };
}

describe('startDaemon', () => {
  it('answers /health with version, uptime, rooms and live members', async () => {
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
      contract_version: FEED_CONTRACT_VERSION,
      rooms: [],
      seq: 0,
      version: CLI_VERSION,
    });
  });

  it('marks members from the last run away on start, since their sessions died with it', async () => {
    const before = sideStore();
    before.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    before.db.close();

    await start();

    const side = sideStore();
    expect(side.store.listMembers('demo').find(member => member.name === 'api')?.presence).toBe('away');
    side.db.close();
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
