import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSearch } from '../../src/cli/search.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  vi.stubEnv('TZ', 'UTC');
  feed = await feedServer();
  const { store } = feed.scratch;
  store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
  store.joinRoom({ as: 'web', kind: 'codex', room: 'billing' });
  store.postMessage({ from: 'api', room: 'checkout', text: 'prices move to cents' });
  store.postMessage({ from: 'web', room: 'billing', text: 'cents in billing\ntoo' });
});

afterEach(async () => {
  await feed.close();
  vi.unstubAllEnvs();
});

const search = async (overrides: Partial<Parameters<typeof runSearch>[0]> = {}) => {
  const result = await runSearch({ dataDir: feed.scratch.dataDir, fetch, q: 'cents', url: feed.url, ...overrides });
  return { ...result, output: stripVTControlCharacters(result.output) };
};

describe('runSearch', () => {
  it('prints one line per match, newest first', async () => {
    await expect(search()).resolves.toStrictEqual({
      code: 0,
      output: ['#billing  10:00  web  cents in billing too', '#checkout  10:00  api  prices move to cents'].join('\n'),
    });
  });

  it('keeps to one room and a limit', async () => {
    await expect(search({ room: 'checkout' })).resolves.toMatchObject({
      output: '#checkout  10:00  api  prices move to cents',
    });
    await expect(search({ limit: 1 })).resolves.toMatchObject({ output: '#billing  10:00  web  cents in billing too' });
  });

  it('says when nothing matches', async () => {
    await expect(search({ q: 'euros' })).resolves.toStrictEqual({ code: 0, output: 'no messages match "euros"' });
  });

  it('says when there is no such room', async () => {
    await expect(search({ room: 'nope' })).resolves.toStrictEqual({
      code: 1,
      output: 'messhall refused the search: no such room',
    });
  });

  it('says the daemon is down in one line', async () => {
    await expect(search({ url: 'http://127.0.0.1:1' })).resolves.toStrictEqual({
      code: 1,
      output: 'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    });
  });
});
