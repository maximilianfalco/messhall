import type { Member, Message } from '../../contracts/room.ts';

import { describe, expect, it } from 'vitest';

import { reviewNudges, reviewQueue, reviewRequest } from '../../src/rooms/reviews.js';

const URL = 'https://github.com/acme/widgets/pull/12';
const OTHER = 'https://github.com/acme/widgets/pull/13';

const message = (id: number, from: string, text: string, at: string, mentions: string[] = []) => ({
  created_at: at,
  edited_at: null,
  from,
  id,
  mentions,
  removed_at: null,
  text,
});

describe('reviewRequest', () => {
  it.each([
    [`ready for review: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 1, url: URL }],
    [`Ready for review: ${URL} @reviewer-2 thanks`, { reviewer: 'reviewer-2', round: 1, url: URL }],
    [`round 2: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 2, url: URL }],
    [`round 3: ${URL}, fixed both blockers @reviewer-1`, { reviewer: 'reviewer-1', round: 3, url: URL }],
    [`CI green. ready for review: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 1, url: URL }],
    [`merged main in! round 2: ${URL} @reviewer-2`, { reviewer: 'reviewer-2', round: 2, url: URL }],
    [`tests green\nready for review: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 1, url: URL }],
  ])('reads %s', (line, expected) => {
    expect(reviewRequest(line)).toStrictEqual(expected);
  });

  it.each([
    [`ready for review: ${URL}`],
    [`approved @f8-thing ${URL}`],
    ['ready for review: https://example.com/pull/12 @reviewer-1'],
    [`PR open: ${URL} @reviewer-1`],
    [`round two: ${URL} @reviewer-1`],
    [`taking ${URL} round 3: checking the merge @reviewer-1`],
    [`you said ready for review: ${URL} @reviewer-1`],
  ])('ignores %s', line => {
    expect(reviewRequest(line)).toBeUndefined();
  });
});

describe('reviewQueue', () => {
  const now = new Date('2026-10-06T12:30:00.000Z');

  it('marks a request answered once someone other than the worker names its url', () => {
    const queue = reviewQueue({
      messages: [
        message(1, 'f8-thing', `ready for review: ${URL} @reviewer-1`, '2026-10-06T12:00:00.000Z'),
        message(2, 'reviewer-1', `@f8-thing 1. blocker: no test ${URL}`, '2026-10-06T12:05:00.000Z'),
      ],
      now,
    });
    expect(queue).toStrictEqual([
      { ageMin: 30, from: 'f8-thing', id: 1, reviewer: 'reviewer-1', round: 1, state: 'answered', url: URL },
    ]);
  });

  it('keeps only the latest round per url and flags it stale after ten minutes', () => {
    const queue = reviewQueue({
      messages: [
        message(1, 'f8-thing', `ready for review: ${URL} @reviewer-1`, '2026-10-06T12:00:00.000Z'),
        message(2, 'reviewer-1', `@f8-thing 1. blocker ${URL}`, '2026-10-06T12:05:00.000Z'),
        message(3, 'f8-thing', `round 2: ${URL} @reviewer-1`, '2026-10-06T12:19:00.000Z'),
        message(4, 'f8-other', `ready for review: ${OTHER} @reviewer-1`, '2026-10-06T12:25:00.000Z'),
      ],
      now,
    });
    expect(queue.map(({ id, round, state }) => ({ id, round, state }))).toStrictEqual([
      { id: 3, round: 2, state: 'stale' },
      { id: 4, round: 1, state: 'waiting' },
    ]);
  });

  it('does not take a reply about a longer PR number as an answer', () => {
    const queue = reviewQueue({
      messages: [
        message(1, 'f8-thing', `ready for review: ${URL} @reviewer-1`, '2026-10-06T12:25:00.000Z'),
        message(2, 'reviewer-1', `@f8-other approved ${URL}3`, '2026-10-06T12:26:00.000Z'),
      ],
      now,
    });
    expect(queue[0]?.state).toBe('waiting');
  });

  it('marks a request answered once the reviewer mentions the worker', () => {
    const queue = reviewQueue({
      messages: [
        message(1, 'f8-thing', `ready for review: ${URL} @reviewer-1`, '2026-10-06T12:00:00.000Z'),
        message(2, 'reviewer-1', '@f8-thing on it', '2026-10-06T12:05:00.000Z', ['f8-thing']),
      ],
      now,
    });
    expect(queue[0]?.state).toBe('answered');
  });

  it('does not count the worker naming its own url again as an answer', () => {
    const queue = reviewQueue({
      messages: [
        message(1, 'f8-thing', `ready for review: ${URL} @reviewer-1`, '2026-10-06T12:00:00.000Z'),
        message(2, 'f8-thing', `still waiting on ${URL}`, '2026-10-06T12:01:00.000Z'),
      ],
      now,
    });
    expect(queue[0]?.state).toBe('stale');
  });
});

describe('reviewNudges', () => {
  const T0 = '2026-10-06T12:00:00.000Z';
  const minutes = (count: number) => new Date(Date.parse(T0) + count * 60_000);

  const seat = (fields: Partial<Member> & Pick<Member, 'name'>): Member => ({
    client_label: null,
    client_name: null,
    client_version: null,
    cursor: 0,
    done: false,
    joined_at: T0,
    kind: 'claude',
    last_seen_at: T0,
    left_at: null,
    muted: false,
    presence: 'idle',
    role: 'worker',
    room_id: 'r1',
    status: null,
    status_at: null,
    ...fields,
  });

  const line = (fields: Partial<Message> & Pick<Message, 'from' | 'id' | 'text'>): Message => ({
    created_at: T0,
    edited_at: null,
    from_client_label: null,
    from_kind: null,
    kind: 'chat',
    mentions: [],
    removed_at: null,
    room_id: 'r1',
    ...fields,
  });

  const REQUEST = line({
    from: 'f8-thing',
    id: 1,
    mentions: ['reviewer-1'],
    text: `ready for review: ${URL} @reviewer-1`,
  });
  const MEMBERS = [
    seat({ kind: 'human', name: 'human', role: 'unassigned' }),
    seat({ name: 'f8-thing' }),
    seat({ name: 'reviewer-1', role: 'reviewer' }),
    seat({ name: 'reviewer-2', role: 'reviewer' }),
    seat({ name: 'lead', role: 'orchestrator' }),
  ];

  it('leaves a request alone for its first ten minutes', () => {
    expect(reviewNudges({ members: MEMBERS, messages: [REQUEST], now: minutes(9) })).toStrictEqual([]);
  });

  it('rings the named reviewer again after ten minutes', () => {
    expect(reviewNudges({ members: MEMBERS, messages: [REQUEST], now: minutes(10) })).toStrictEqual([
      { id: 1, kind: 'ring', reviewer: 'reviewer-1', url: URL, worker: 'f8-thing' },
    ]);
  });

  it('hands the request to the other live reviewers after fifteen minutes', () => {
    const members = [
      ...MEMBERS,
      seat({ name: 'reviewer-3', role: 'reviewer' }),
      seat({ name: 'reviewer-4', presence: 'away', role: 'reviewer' }),
      seat({ left_at: T0, name: 'reviewer-5', presence: 'left', role: 'reviewer' }),
    ];
    expect(reviewNudges({ members, messages: [REQUEST], now: minutes(15) })).toStrictEqual([
      {
        id: 1,
        kind: 'line',
        mentions: ['reviewer-2', 'reviewer-3'],
        text: `@reviewer-2 @reviewer-3 ${URL} waited 15 min on reviewer-1, can one of you take it`,
      },
    ]);
  });

  it.each([
    ['the orchestrator', MEMBERS.filter(member => member.name !== 'reviewer-2'), 'lead'],
    ['the human', MEMBERS.filter(member => member.role !== 'orchestrator' && member.name !== 'reviewer-2'), 'human'],
  ])('falls back to %s with no other live reviewer', (_, members, target) => {
    expect(reviewNudges({ members, messages: [REQUEST], now: minutes(15) })).toStrictEqual([
      {
        id: 1,
        kind: 'line',
        mentions: [target],
        text: `@${target} ${URL} waited 15 min on reviewer-1, can you take it`,
      },
    ]);
  });

  it.each([
    [
      'the reviewer mentions the worker',
      line({ from: 'reviewer-1', id: 2, mentions: ['f8-thing'], text: '@f8-thing on it' }),
    ],
    ['anyone else names the url', line({ from: 'reviewer-2', id: 2, text: `taking ${URL}` })],
  ])('never nudges once %s', (_, answer) => {
    expect(reviewNudges({ members: MEMBERS, messages: [REQUEST, answer], now: minutes(20) })).toStrictEqual([]);
  });

  it('posts no second line once its own line names the url', () => {
    const text = `@reviewer-2 ${URL} waited 15 min on reviewer-1, can you take it`;
    const posted = line({ from: 'messhall', id: 2, kind: 'system', mentions: ['reviewer-2'], text });
    expect(reviewNudges({ members: MEMBERS, messages: [REQUEST, posted], now: minutes(16) })).toStrictEqual([]);
  });

  it('nudges a new round again after an answered one', () => {
    const answer = line({ from: 'reviewer-1', id: 2, mentions: ['f8-thing'], text: '@f8-thing 1. blocker' });
    const round = line({
      created_at: minutes(5).toISOString(),
      from: 'f8-thing',
      id: 3,
      text: `round 2: ${URL} @reviewer-1`,
    });
    expect(reviewNudges({ members: MEMBERS, messages: [REQUEST, answer, round], now: minutes(15) })).toStrictEqual([
      { id: 3, kind: 'ring', reviewer: 'reviewer-1', url: URL, worker: 'f8-thing' },
    ]);
  });

  it('ignores a request older than an hour', () => {
    expect(reviewNudges({ members: MEMBERS, messages: [REQUEST], now: minutes(60) })).toStrictEqual([]);
  });
});
