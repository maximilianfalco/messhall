import { rmSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSay } from '../../src/cli/say.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
});

afterEach(async () => {
  await feed.close();
});

const say = (overrides: Partial<Parameters<typeof runSay>[0]> = {}) =>
  runSay({
    dataDir: feed.scratch.dataDir,
    fetch,
    room: 'demo',
    text: 'api, also bump the version',
    url: feed.url,
    ...overrides,
  });

describe('runSay', () => {
  it('posts as the human and prints the message id', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    const result = await say();

    const last = feed.scratch.store.listMessages({ limit: 1, room: 'demo' });
    expect(last.ok && last.messages[0]).toMatchObject({ from: 'human', text: 'api, also bump the version' });
    expect(result).toStrictEqual({ code: 0, output: String(last.ok && last.messages[0]!.id) });
  });

  it('says the daemon is down in one line', async () => {
    const result = await say({ url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    );
  });

  it('passes on the daemon refusal in one line', async () => {
    const result = await say({ room: 'nope' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe('messhall refused the post: no such room');
  });

  it('says so when there is no human key yet', async () => {
    rmSync(path.join(feed.scratch.dataDir, KEY_FILES.human));

    const result = await say();

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toMatch(/^no human key in .+, start the daemon once$/);
  });
});
