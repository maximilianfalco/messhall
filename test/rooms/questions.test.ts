import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QUESTION_TTL_MS } from '../../src/config.js';

import { scratchStore } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'web', kind: 'claude', room: 'demo' });
  scratch.store.ensureHuman('demo');
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;

const ask = (overrides: Partial<Parameters<ReturnType<typeof scratchStore>['store']['askQuestion']>[0]> = {}) =>
  store().askQuestion({ as: 'api', options: ['ship it', 'wait'], question: 'merge now?', room: 'demo', ...overrides });

const asked = () => {
  const result = ask();
  if (!result.ok) throw new Error(result.reason);
  return result.question;
};

const questionEvents = (events: SequencedEvent[]) =>
  events.flatMap(({ event }) => (event.type === 'question' ? [[event.question.member, event.question.state]] : []));

const lastLine = () => store().listMessages({ limit: 1, room: 'demo' });

describe('askQuestion', () => {
  it('posts the question as the asker line to the human and keeps it open', () => {
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const question = asked();

    expect(question).toMatchObject({
      answer: null,
      answered_at: null,
      member: 'api',
      options: ['ship it', 'wait'],
      question: 'merge now?',
      room: 'demo',
      state: 'open',
    });
    const page = lastLine();
    expect(page.ok && page.messages[0]).toMatchObject({
      from: 'api',
      id: question.message_id,
      kind: 'chat',
      mentions: ['human'],
      text: '@human merge now?\n1. ship it\n2. wait',
    });
    expect(questionEvents(seen)).toStrictEqual([['api', 'open']]);
    expect(store().openQuestions('demo')).toStrictEqual([question]);
  });

  it('replaces the asker older open question in the room', () => {
    const older = asked();

    const newer = asked();

    expect(store().openQuestions('demo')).toStrictEqual([newer]);
    expect(store().openQuestions('demo').map(item => item.id)).not.toContain(older.id);
  });

  it('keeps open questions from different agents side by side', () => {
    const fromApi = asked();
    const fromWeb = ask({ as: 'web' });

    expect(store().openQuestions('demo')).toStrictEqual([fromApi, fromWeb.ok && fromWeb.question]);
  });

  it.each([
    ['not_member', { as: 'ghost' }],
    ['no_room', { room: 'nowhere' }],
  ] as const)('refuses with %s', (reason, overrides) => {
    expect(ask(overrides)).toStrictEqual({ ok: false, reason });
  });

  it('refuses a muted asker', () => {
    store().muteMember({ by: 'human', member: 'api', muted: true, room: 'demo' });

    expect(ask()).toStrictEqual({ ok: false, reason: 'muted' });
  });

  it('refuses in a closed room', () => {
    store().closeRoom('demo');

    expect(ask()).toStrictEqual({ ok: false, reason: 'room_closed' });
  });
});

describe('answerQuestion', () => {
  it('closes the question and posts a human line that names the asker and the label only', () => {
    const question = asked();

    const result = store().answerQuestion({ id: question.id, option: 1 });

    expect(result.ok && result.question).toMatchObject({ answer: 1, id: question.id, state: 'answered' });
    expect(result.ok && result.message).toMatchObject({
      from: 'human',
      mentions: ['api'],
      text: `@api answer to your question #${question.message_id}: wait`,
    });
    expect(store().openQuestions('demo')).toStrictEqual([]);
  });

  it('answers a question once', () => {
    const question = asked();
    store().answerQuestion({ id: question.id, option: 0 });

    expect(store().answerQuestion({ id: question.id, option: 1 })).toStrictEqual({ ok: false, reason: 'no_question' });
  });

  it('refuses an option out of range and leaves the question open', () => {
    const question = asked();

    expect(store().answerQuestion({ id: question.id, option: 2 })).toStrictEqual({ ok: false, reason: 'bad_option' });
    expect(store().openQuestions('demo')).toStrictEqual([question]);
  });

  it('refuses a replaced question', () => {
    const older = asked();
    asked();

    expect(store().answerQuestion({ id: older.id, option: 0 })).toStrictEqual({ ok: false, reason: 'no_question' });
  });

  it('reopens a closed room to answer, as any human line does', () => {
    const question = asked();
    store().closeRoom('demo');

    const result = store().answerQuestion({ id: question.id, option: 0 });

    expect(result.ok).toBe(true);
    expect(store().listRooms().find(room => room.name === 'demo')?.closed_at).toBeNull();
  });
});

describe('expireQuestions', () => {
  it('closes a question left 30 minutes with a messhall line to the asker', () => {
    const question = asked();
    scratch.clock.advance(QUESTION_TTL_MS);

    const expired = store().expireQuestions();

    expect(expired.map(item => [item.id, item.state])).toStrictEqual([[question.id, 'expired']]);
    const page = lastLine();
    expect(page.ok && page.messages[0]).toMatchObject({
      from: 'messhall',
      kind: 'system',
      mentions: ['api'],
      text: `@api no answer from the human to your question #${question.message_id}, carry on with your best call and say which`,
    });
    expect(store().openQuestions('demo')).toStrictEqual([]);
  });

  it('leaves a younger question open', () => {
    asked();
    scratch.clock.advance(QUESTION_TTL_MS - 1);

    expect(store().expireQuestions()).toStrictEqual([]);
  });
});

describe('questionsOf', () => {
  it('lists only the asker open questions in the room', () => {
    const mine = asked();
    ask({ as: 'web' });

    expect(store().questionsOf({ as: 'api', room: 'demo' })).toStrictEqual([mine]);
  });
});
