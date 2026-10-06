import type { BusEvent } from '../../contracts/events.ts';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWatch, runWatch } from '../../src/cli/watch.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;
let lines: string[];

beforeEach(async () => {
  feed = await feedServer();
  vi.stubEnv('TZ', 'UTC');
  lines = [];
});

afterEach(async () => {
  await feed.close();
});

const print = (line: string) => lines.push(stripVTControlCharacters(line));
const store = () => feed.scratch.store;

const messageFrame = ({ id, room, text }: { id: number; room: string; text: string }) => {
  const event: BusEvent = {
    message: {
      created_at: '2026-01-01T10:00:00.000Z',
      from: 'api',
      from_client_label: null,
      from_kind: null,
      id,
      kind: 'chat',
      mentions: [],
      room_id: 'room-1',
      text,
    },
    room,
    type: 'message',
  };
  return { data: JSON.stringify(event), event: 'message', id: String(id) };
};

interface Call {
  init?: RequestInit;
  url: string;
}

function fakeFetch(answer: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ init, url });
    return Promise.resolve().then(() => answer({ init, url }, calls.length - 1));
  };
  return { calls, fetch };
}

function keyedDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'messhall-watch-'));
  writeFileSync(path.join(dir, KEY_FILES.human), 'h'.repeat(64));
  return dir;
}

describe('runWatch', () => {
  it('prints the snapshot and exits 0 without a tty', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    store().postMessage({ from: 'api', room: 'checkout', text: 'hello from api' });

    const code = await runWatch({ dataDir: feed.scratch.dataDir, fetch, print, tty: false, url: feed.url });

    expect(code).toBe(0);
    expect(lines).toStrictEqual([
      '#checkout  open, 1 posts',
      '       api active, human',
      '10:00  api joined',
      '10:00  api  hello from api',
    ]);
  });

  it('says the daemon is down in one line and exits 1', async () => {
    const code = await runWatch({
      dataDir: feed.scratch.dataDir,
      fetch,
      print,
      tty: false,
      url: 'http://127.0.0.1:1',
    });

    expect(code).toBe(1);
    expect(lines).toStrictEqual(['messhall is down, nothing answers on http://127.0.0.1:1. run messhall start']);
  });

  it('says so when there is no human key yet', async () => {
    rmSync(path.join(feed.scratch.dataDir, KEY_FILES.human));

    const code = await runWatch({ dataDir: feed.scratch.dataDir, fetch, print, tty: false, url: feed.url });

    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^no human key in .+, start the daemon once$/);
  });
});

describe('createWatch', () => {
  it('filters the feed to the room picked with /room', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    store().joinRoom({ as: 'web', kind: 'codex', room: 'search' });
    const watch = createWatch({ dataDir: feed.scratch.dataDir, fetch, print, room: 'checkout', url: feed.url });

    await watch.handle('/room search');
    lines = [];
    watch.onFrame(messageFrame({ id: 20, room: 'checkout', text: 'not here' }));
    watch.onFrame(messageFrame({ id: 21, room: 'search', text: 'over here' }));

    expect(watch.room).toBe('search');
    expect(lines).toStrictEqual(['10:00  api  over here']);
  });

  it('lists every room with /rooms', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    const watch = createWatch({ dataDir: feed.scratch.dataDir, fetch, print, url: feed.url });

    await watch.handle('/rooms');

    expect(lines).toStrictEqual(['#checkout  open, 2 members, 0 posts']);
  });

  it('posts a line as the human to the room route with the human key', async () => {
    const dir = keyedDir();
    const { calls, fetch } = fakeFetch(() => new Response('{}', { status: 201 }));
    const watch = createWatch({ dataDir: dir, fetch, print, room: 'checkout', url: 'http://127.0.0.1:7795' });

    await watch.handle('api, bump the version too');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:7795/api/rooms/checkout/messages');
    expect(calls[0]!.init).toMatchObject({
      body: JSON.stringify({ text: 'api, bump the version too' }),
      headers: { [KEY_HEADER]: 'h'.repeat(64) },
      method: 'POST',
    });
    rmSync(dir, { force: true, recursive: true });
  });

  it('reopens the room with the human key', async () => {
    const dir = keyedDir();
    const { calls, fetch } = fakeFetch(() => new Response('{}', { status: 200 }));
    const watch = createWatch({ dataDir: dir, fetch, print, room: 'checkout', url: 'http://127.0.0.1:7795' });

    await watch.handle('/reopen');

    expect(calls[0]!.url).toBe('http://127.0.0.1:7795/api/rooms/checkout/reopen');
    expect(calls[0]!.init).toMatchObject({ headers: { [KEY_HEADER]: 'h'.repeat(64) }, method: 'POST' });
    expect(lines).toStrictEqual([]);
    rmSync(dir, { force: true, recursive: true });
  });

  it('prints the refusal when the daemon will not reopen', async () => {
    const watch = createWatch({ dataDir: feed.scratch.dataDir, fetch, print, room: 'nope', url: feed.url });

    await watch.handle('/reopen');

    expect(lines).toStrictEqual(['messhall refused the reopen: no such room']);
  });

  it('asks for a room before posting while watching every room', async () => {
    const { calls, fetch } = fakeFetch(() => new Response('{}'));
    const watch = createWatch({ dataDir: feed.scratch.dataDir, fetch, print, url: feed.url });

    await watch.handle('hello');

    expect(calls).toStrictEqual([]);
    expect(lines).toStrictEqual(['pick a room first: /room <name>']);
  });

  it('quits on /quit', async () => {
    const watch = createWatch({ dataDir: feed.scratch.dataDir, fetch, print, url: feed.url });

    await expect(watch.handle('/quit')).resolves.toBe('quit');
  });

  it('reconnects with Last-Event-ID after the stream drops', async () => {
    const controller = new AbortController();
    const frame = messageFrame({ id: 7, room: 'checkout', text: 'before the drop' });
    const { calls, fetch } = fakeFetch((_, index) => {
      if (index === 0) return new Response(`id: 7\nevent: message\ndata: ${frame.data}\n\n`);
      controller.abort();
      throw new Error('aborted');
    });
    const watch = createWatch({ dataDir: keyedDir(), fetch, print, room: 'checkout', url: 'http://127.0.0.1:7795' });

    await watch.follow({ signal: controller.signal, wait: async () => {} });

    expect(calls.map(call => new Headers(call.init?.headers).get('last-event-id'))).toStrictEqual(['0', '7']);
    expect(lines).toStrictEqual(['10:00  api  before the drop', 'feed dropped, reconnecting']);
  });
});
