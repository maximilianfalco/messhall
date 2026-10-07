import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore } from './scratch.js';

const URL = 'https://github.com/acme/widgets/pull/12';
const MINUTE = 60_000;

let scratch: ReturnType<typeof scratchStore>;
let requestId = 0;

beforeEach(() => {
  scratch = scratchStore();
  for (const as of ['f8-thing', 'reviewer-1', 'reviewer-2']) {
    scratch.store.joinRoom({ as, kind: 'claude', room: 'demo' });
  }
  scratch.store.ensureHuman('demo');
  for (const member of ['reviewer-1', 'reviewer-2']) {
    scratch.store.assignRole({ by: 'human', member, role: 'reviewer', room: 'demo' });
  }
  const request = scratch.store.postMessage({
    from: 'f8-thing',
    room: 'demo',
    text: `ready for review: ${URL} @reviewer-1`,
  });
  requestId = request.ok ? request.message.id : 0;
});

afterEach(() => {
  scratch.cleanup();
});

const lines = () => {
  const page = scratch.store.listMessages({ limit: 50, room: 'demo' });
  return page.ok ? page.messages.filter(message => message.id > requestId).map(message => message.text) : [];
};

describe('nudgeReviews', () => {
  it('rings the named reviewer at ten minutes without a line', () => {
    scratch.clock.advance(10 * MINUTE);

    expect(scratch.store.nudgeReviews()).toStrictEqual([
      { id: requestId, kind: 'claude', reviewer: 'reviewer-1', room: 'demo', url: URL, worker: 'f8-thing' },
    ]);
    expect(lines()).toStrictEqual([]);
  });

  it('posts one hand-off line at fifteen minutes and never a second', () => {
    scratch.clock.advance(15 * MINUTE);
    scratch.store.nudgeReviews();
    scratch.clock.advance(5 * MINUTE);
    scratch.store.nudgeReviews();

    expect(lines()).toStrictEqual([`@reviewer-2 ${URL} waited 15 min on reviewer-1, can you take it`]);
    const page = scratch.store.listMessages({ limit: 1, room: 'demo' });
    expect(page.ok && page.messages[0]?.mentions).toStrictEqual(['reviewer-2']);
  });

  it('does nothing in a room with nudges turned off', () => {
    expect(scratch.store.setReviewNudges({ on: false, room: 'demo' }).ok).toBe(true);
    scratch.clock.advance(15 * MINUTE);

    expect(scratch.store.nudgeReviews()).toStrictEqual([]);
    expect(lines()).toStrictEqual(['review nudges turned off']);
  });

  it('nudges again once turned back on', () => {
    scratch.store.setReviewNudges({ on: false, room: 'demo' });
    scratch.store.setReviewNudges({ on: true, room: 'demo' });
    scratch.clock.advance(10 * MINUTE);

    expect(scratch.store.nudgeReviews()).toHaveLength(1);
  });

  it('refuses a room that does not exist', () => {
    expect(scratch.store.setReviewNudges({ on: false, room: 'nope' })).toStrictEqual({ ok: false, reason: 'no_room' });
  });
});
