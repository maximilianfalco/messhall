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

const item = (header: string | null, labels: string[], multi_select = false) => ({
  header,
  multi_select,
  options: labels.map(label => ({ description: null, label, recommended: false })),
  question: 'merge now?',
});

const asked = (questions = [item(null, ['ship it', 'wait'])]) => {
  const result = feed.scratch.store.askQuestion({ as: 'api', questions, room: 'demo' });
  if (!result.ok) throw new Error(result.reason);
  return result.question;
};

const answer = (overrides: Partial<Parameters<typeof runAnswer>[0]> = {}) =>
  runAnswer({
    dataDir: feed.scratch.dataDir,
    fetch,
    id: overrides.id ?? asked().id,
    picks: ['2'],
    url: feed.url,
    ...overrides,
  });

const lastText = () => {
  const last = feed.scratch.store.listMessages({ limit: 1, room: 'demo' });
  return last.ok ? last.messages[0]?.text : undefined;
};

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

  it('takes one answer per question: a number, numbers with commas, or words of your own', async () => {
    const question = asked([item('Merge', ['ship it', 'wait']), item('Suites', ['unit', 'e2e', 'smoke'], true)]);

    const result = await answer({ id: question.id, picks: ['after lunch', '1,3'] });

    expect(result.code).toBe(0);
    expect(lastText()).toBe(
      [`@api answer to your question #${question.message_id}:`, 'Merge: "after lunch"', 'Suites: unit, smoke'].join(
        '\n',
      ),
    );
  });

  it.each(['0', '1,0'])('refuses pick %s before calling the daemon', async pick => {
    const result = await answer({ picks: [pick], url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(`a pick is a number from 1, not ${pick}`);
  });

  it('passes on the daemon refusal in one line', async () => {
    const result = await answer({ picks: ['3'] });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toMatch(/^messhall refused the answer: those answers do not fit/);
  });

  it('says the daemon is down in one line', async () => {
    const result = await answer({ url: 'http://127.0.0.1:1' });

    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    );
  });
});
