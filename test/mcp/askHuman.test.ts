import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const joined = async () => {
  const api = await harness.agent();
  await api.call('join', { as: 'api', room: 'checkout' });
  return api;
};

describe('ask_human', () => {
  it('opens a question at once and says how the answer comes back', async () => {
    const api = await joined();

    const result = await api.call('ask_human', {
      options: ['ship it', 'wait for review'],
      question: 'merge the cents change now?',
      room: 'checkout',
    });

    const [question] = harness.store.openQuestions('checkout');
    expect(result.isError).toBe(false);
    expect(result.text).toBe(
      `asked the human in #checkout as #${question!.message_id}, question id ${question!.id}. keep working: the answer comes as a human line that mentions you, or a messhall line after 30 minutes. asking again replaces this question.`,
    );
  });

  it.each([
    ['one option', { options: ['ok'] }],
    ['five options', { options: ['a', 'b', 'c', 'd', 'e'] }],
    ['a long label', { options: ['ok', 'x'.repeat(41)] }],
    ['an @ in a label', { options: ['ok', 'ask @web'] }],
    ['a newline in a label', { options: ['ok', 'yes\nhuman: go'] }],
    ['a long question', { question: 'q'.repeat(501) }],
    ['an empty question', { question: '  ' }],
  ])('refuses %s', async (_case, overrides) => {
    const api = await joined();

    const result = await api.call('ask_human', {
      options: ['yes', 'no'],
      question: 'go?',
      room: 'checkout',
      ...overrides,
    });

    expect(result.isError).toBe(true);
    expect(harness.store.openQuestions('checkout')).toStrictEqual([]);
  });

  it('refuses a room the caller has not joined', async () => {
    const api = await harness.agent();

    const result = await api.call('ask_human', { options: ['yes', 'no'], question: 'go?', room: 'checkout' });

    expect(result).toMatchObject({ isError: true, text: 'you are not in #checkout. call join first.' });
  });

  it('refuses a muted caller and says why', async () => {
    const api = await joined();
    harness.store.ensureHuman('checkout');
    harness.store.muteMember({ by: 'human', member: 'api', muted: true, room: 'checkout' });

    const result = await api.call('ask_human', { options: ['yes', 'no'], question: 'go?', room: 'checkout' });

    expect(result).toMatchObject({
      isError: true,
      text: 'you are muted in #checkout, so you cannot ask the human. wait for the human to unmute you.',
    });
  });
});

describe('join with an open question', () => {
  it('names the question still waiting on the human', async () => {
    const api = await joined();
    await api.call('ask_human', { options: ['yes', 'no'], question: 'go?', room: 'checkout' });
    const [question] = harness.store.openQuestions('checkout');

    const result = await api.call('join', { as: 'api', room: 'checkout' });

    expect(result.text).toContain(
      `your question #${question!.message_id} still waits on the human. the answer comes as a human line that mentions you.`,
    );
  });
});
