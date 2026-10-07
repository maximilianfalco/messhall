import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAnswer } from '../../src/cli/answer.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
  feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
});

afterEach(async () => {
  await feed.close();
});

const asked = () => {
  const result = feed.scratch.store.askQuestion({
    as: 'api',
    options: ['ship it', 'wait'],
    question: 'merge now?',
    room: 'demo',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.question;
};

const answer = (overrides: Partial<Parameters<typeof runAnswer>[0]> = {}) =>
  runAnswer({ dataDir: feed.scratch.dataDir, fetch, id: asked().id, option: '2', url: feed.url, ...overrides });

describe('runAnswer', () => {
  it('picks the numbered option as the human and prints the answer line', async () => {
    const result = await answer();

    const last = feed.scratch.store.listMessages({ limit: 1, room: 'demo' });
    expect(last.ok && last.messages[0]).toMatchObject({ from: 'human', mentions: ['api'] });
    expect(result).toStrictEqual({
      code: 0,
      output: `#${last.ok && last.messages[0]!.id} ${last.ok && last.messages[0]!.text}`,
    });
  });

  it.each(['0', '1.5', 'two'])('refuses option %s before calling the daemon', async option => {
    const result = await answer({ option, url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(`option is a button number from 1, not ${option}`);
  });

  it('passes on the daemon refusal in one line', async () => {
    const result = await answer({ option: '3' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toMatch(
      /^messhall refused the answer: question .* has no option 2$/,
    );
  });

  it('says the daemon is down in one line', async () => {
    const result = await answer({ url: 'http://127.0.0.1:1' });

    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    );
  });
});
