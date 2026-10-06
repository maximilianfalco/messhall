import { describe, expect, it } from 'vitest';

import { reviewQueue, reviewRequest } from '../../tools/dev/lib/review.js';

const URL = 'https://github.com/acme/widgets/pull/12';
const OTHER = 'https://github.com/acme/widgets/pull/13';

const message = (id: number, from: string, text: string, at: string) => ({ created_at: at, from, id, text });

describe('reviewRequest', () => {
  it.each([
    [`ready for review: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 1, url: URL }],
    [`Ready for review: ${URL} @reviewer-2 thanks`, { reviewer: 'reviewer-2', round: 1, url: URL }],
    [`round 2: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 2, url: URL }],
    [`round 3: ${URL}, fixed both blockers @reviewer-1`, { reviewer: 'reviewer-1', round: 3, url: URL }],
    [`CI green. ready for review: ${URL} @reviewer-1`, { reviewer: 'reviewer-1', round: 1, url: URL }],
    [`merged main in! round 2: ${URL} @reviewer-2`, { reviewer: 'reviewer-2', round: 2, url: URL }],
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
