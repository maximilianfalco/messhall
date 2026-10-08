import type { SequencedEvent } from '../../contracts/events.ts';
import type { QuestionItem, QuestionOption } from '../../contracts/room.ts';

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

const choice = (label: string, extra: Partial<QuestionOption> = {}): QuestionOption => ({
  description: null,
  label,
  recommended: false,
  ...extra,
});

const item = (extra: Partial<QuestionItem> = {}): QuestionItem => ({
  header: null,
  multi_select: false,
  options: [choice('ship it'), choice('wait')],
  question: 'merge now?',
  ...extra,
});

const threeItems = [
  item({ header: 'Merge', options: [choice('ship it', { recommended: true }), choice('wait')] }),
  item({
    header: 'Suites',
    multi_select: true,
    options: [choice('unit'), choice('e2e'), choice('smoke')],
    question: 'which suites run first?',
  }),
  item({ header: 'Scope', options: [choice('api only'), choice('api and web')], question: 'how wide?' }),
];

const ask = (overrides: Partial<Parameters<ReturnType<typeof scratchStore>['store']['askQuestion']>[0]> = {}) =>
  store().askQuestion({ as: 'api', questions: [item()], room: 'demo', ...overrides });

const pick = (...picks: number[]) => ({ other: null, picks });

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
      answered_at: null,
      answers: null,
      member: 'api',
      questions: [item()],
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

  it('lists every question with its header, a recommended mark and a pick any hint', () => {
    const result = ask({ questions: threeItems });

    const page = lastLine();
    expect(result.ok && result.question.questions).toStrictEqual(threeItems);
    expect(page.ok && page.messages[0]?.text).toBe(
      [
        '@human Merge: merge now?',
        '1. ship it (recommended)',
        '2. wait',
        'Suites: which suites run first? (pick any)',
        '1. unit',
        '2. e2e',
        '3. smoke',
        'Scope: how wide?',
        '1. api only',
        '2. api and web',
      ].join('\n'),
    );
  });

  it('replaces the asker older open question in the room', () => {
    const older = asked();

    const newer = asked();

    expect(store().openQuestions('demo')).toStrictEqual([newer]);
    expect(
      store()
        .openQuestions('demo')
        .map(open => open.id),
    ).not.toContain(older.id);
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

    const result = store().answerQuestion({ answers: [pick(1)], id: question.id });

    expect(result.ok && result.question).toMatchObject({ answers: [pick(1)], id: question.id, state: 'answered' });
    expect(result.ok && result.message).toMatchObject({
      from: 'human',
      mentions: ['api'],
      text: `@api answer to your question #${question.message_id}: wait`,
    });
    expect(store().openQuestions('demo')).toStrictEqual([]);
  });

  it('answers a question once', () => {
    const question = asked();
    store().answerQuestion({ answers: [pick(0)], id: question.id });

    expect(store().answerQuestion({ answers: [pick(1)], id: question.id })).toStrictEqual({
      ok: false,
      reason: 'no_question',
    });
  });

  it('names each header and the picks, typed text in quotes, one line per question', () => {
    const result = ask({ questions: threeItems });
    const question = result.ok ? result.question : undefined;

    const answered = store().answerQuestion({
      answers: [pick(0), { other: 'and a lint run', picks: [0, 2] }, { other: 'just the store', picks: [] }],
      id: question!.id,
    });

    expect(answered.ok && answered.message.text).toBe(
      [
        `@api answer to your question #${question!.message_id}:`,
        'Merge: ship it',
        'Suites: unit, smoke, "and a lint run"',
        'Scope: "just the store"',
      ].join('\n'),
    );
  });

  it('keeps one headed question on one line', () => {
    const result = ask({ questions: [threeItems[0]!] });
    const question = result.ok ? result.question : undefined;

    const answered = store().answerQuestion({ answers: [pick(1)], id: question!.id });

    expect(answered.ok && answered.message.text).toBe(
      `@api answer to your question #${question!.message_id}: Merge: wait`,
    );
  });

  it.each([
    ['a pick out of range', [pick(2)]],
    ['two picks on a pick one question', [pick(0, 1)]],
    ['a pick and typed text on a pick one question', [{ other: 'later', picks: [0] }]],
    ['no pick and no text', [pick()]],
    ['the same pick twice', [pick(0, 0)]],
    ['too few answers', []],
    ['too many answers', [pick(0), pick(1)]],
  ])('refuses %s and leaves the question open', (_case, answers) => {
    const question = asked();

    expect(store().answerQuestion({ answers, id: question.id })).toStrictEqual({ ok: false, reason: 'bad_answer' });
    expect(store().openQuestions('demo')).toStrictEqual([question]);
  });

  it('takes typed text alone on a pick one question', () => {
    const question = asked();

    const result = store().answerQuestion({ answers: [{ other: 'ship after lunch', picks: [] }], id: question.id });

    expect(result.ok && result.message.text).toBe(
      `@api answer to your question #${question.message_id}: "ship after lunch"`,
    );
  });

  it('refuses a replaced question', () => {
    const older = asked();
    asked();

    expect(store().answerQuestion({ answers: [pick(0)], id: older.id })).toStrictEqual({
      ok: false,
      reason: 'no_question',
    });
  });

  it('reopens a closed room to answer, as any human line does', () => {
    const question = asked();
    store().closeRoom('demo');

    const result = store().answerQuestion({ answers: [pick(0)], id: question.id });

    expect(result.ok).toBe(true);
    expect(
      store()
        .listRooms()
        .find(room => room.name === 'demo')?.closed_at,
    ).toBeNull();
  });
});

describe('expireQuestions', () => {
  it('closes a question left 30 minutes with a messhall line to the asker', () => {
    const question = asked();
    scratch.clock.advance(QUESTION_TTL_MS);

    const expired = store().expireQuestions();

    expect(expired.map(closed => [closed.id, closed.state])).toStrictEqual([[question.id, 'expired']]);
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

describe('settledQuestions', () => {
  it('lists the answered, replaced and expired questions, never the open ones', () => {
    const answered = asked();
    store().answerQuestion({ answers: [pick(0)], id: answered.id });
    const replaced = asked();
    const open = asked();

    expect(
      store()
        .settledQuestions('demo')
        .map(question => [question.id, question.state]),
    ).toStrictEqual([
      [answered.id, 'answered'],
      [replaced.id, 'replaced'],
    ]);
    expect(
      store()
        .openQuestions('demo')
        .map(question => question.id),
    ).toStrictEqual([open.id]);
  });
});
