import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEY_HEADER } from '../../src/daemon/keys.js';
import { tailFeed } from '../../tools/dev/commands/feed.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
});

afterEach(async () => {
  await feed.close();
});

const store = () => feed.scratch.store;

async function tail(options: { count: number; room?: string; since?: number }, act?: () => void) {
  const lines: string[] = [];
  const done = tailFeed({
    fetch,
    key: feed.headers('human')[KEY_HEADER]!,
    print: line => lines.push(stripVTControlCharacters(line)),
    url: feed.url,
    ...options,
  });
  if (act) {
    await vi.waitUntil(() => feed.timer.running === 1);
    act();
  }
  return { code: await done, lines };
}

describe('tailFeed', () => {
  it('prints the snapshot, then one line per event, and stops at the count', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });

    const result = await tail({ count: 3 }, () => {
      store().touch({ as: 'api', room: 'checkout', state: 'waiting' });
      store().postMessage({ from: 'api', room: 'checkout', text: '@human hello from api' });
    });

    expect(result).toStrictEqual({
      code: 0,
      lines: [
        '#4 snapshot  1 room: #checkout 2 members, 1 message',
        '#5 presence  #checkout api active → waiting',
        '#6 message   #checkout [#2 api → @human] @human hello from api',
      ],
    });
  });

  it('replays from --since and prints member and room events', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });

    const result = await tail({ count: 3, since: 0 });

    expect(result.lines).toStrictEqual([
      '#1 room      #checkout created',
      '#2 member    #checkout human joined (human)',
      '#3 member    #checkout api joined (claude)',
    ]);
  });

  it('keeps only the room asked for', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'other' });

    const result = await tail({ count: 1, room: 'checkout', since: 0 }, () => {
      store().joinRoom({ as: 'web', kind: 'codex', room: 'checkout' });
    });

    expect(result.lines).toStrictEqual(['#5 room      #checkout created']);
  });

  it('says so in one line when the daemon is down', async () => {
    const lines: string[] = [];

    const code = await tailFeed({
      count: 1,
      fetch,
      key: 'k',
      print: line => lines.push(line),
      url: 'http://127.0.0.1:1',
    });

    expect(code).toBe(1);
    expect(lines.map(line => stripVTControlCharacters(line))).toStrictEqual([
      '✖ messhall is down, nothing answers on http://127.0.0.1:1',
    ]);
  });

  it('says so when the daemon refuses the key', async () => {
    const lines: string[] = [];

    const code = await tailFeed({ count: 1, fetch, key: 'wrong', print: line => lines.push(line), url: feed.url });

    expect(code).toBe(1);
    expect(lines.map(line => stripVTControlCharacters(line))).toStrictEqual(['✖ the feed answered 401']);
  });
});
