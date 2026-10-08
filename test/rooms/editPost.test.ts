import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore } from './scratch.js';

const MINUTE = 60_000;
let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'web', kind: 'codex', room: 'demo' });
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;
const post = (from: string, text: string, done?: boolean) => {
  const result = store().postMessage({ done, from, room: 'demo', text });
  if (!result.ok) throw new Error(`post failed: ${result.reason}`);
  return result.message;
};
const edit = (as: string, text: string) => store().editPost({ as, room: 'demo', text });
const remove = (as: string) => store().removePost({ as, room: 'demo' });
const search = (q: string) => {
  const found = store().searchMessages({ q });
  return found.ok ? found.messages.map(message => message.id) : [];
};

describe('editPost', () => {
  it('replaces the text of the last own post and marks it edited', () => {
    const sent = post('api', 'ship it @web');

    const result = edit('api', 'hold off @web');

    expect(result).toMatchObject({
      message: {
        edited_at: '2026-01-01T10:00:00.000Z',
        id: sent.id,
        mentions: ['web'],
        removed_at: null,
        text: 'hold off @web',
      },
      ok: true,
    });
  });

  it('emits a message_edit event and no message event, so nobody is rung twice', () => {
    post('api', 'ship it @web');
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    edit('api', 'hold off @web');

    expect(seen.map(({ event }) => event.type)).toStrictEqual(['message_edit']);
  });

  it('shows the new text to a reader who has not read it yet', () => {
    post('api', 'ship it @web');
    edit('api', 'hold off @web');

    const read = store().readUnseen({ as: 'web', room: 'demo' });

    expect(read).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ edited_at: expect.any(String), text: 'hold off @web' }),
      ]),
      ok: true,
    });
  });

  it('only touches the last post when the member has posted twice', () => {
    const first = post('api', 'one');
    post('api', 'two');

    edit('api', 'two, fixed');

    expect(store().listMessages({ limit: 10, room: 'demo' })).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ edited_at: null, id: first.id, text: 'one' })]),
    });
  });

  it('ignores posts from others and system lines when it looks for the last own post', () => {
    const mine = post('api', 'mine');
    post('web', 'theirs');

    expect(edit('api', 'mine, fixed')).toMatchObject({ message: { id: mine.id }, ok: true });
  });

  it('is refused after five minutes', () => {
    post('api', 'ship it');
    scratch.clock.advance(5 * MINUTE + 1);

    expect(edit('api', 'hold off')).toStrictEqual({ ok: false, reason: 'too_old' });
  });

  it('still works at exactly five minutes', () => {
    post('api', 'ship it');
    scratch.clock.advance(5 * MINUTE);

    expect(edit('api', 'hold off')).toMatchObject({ ok: true });
  });

  it('is refused when the member has no post', () => {
    expect(edit('api', 'hold off')).toStrictEqual({ ok: false, reason: 'no_post' });
  });

  it('is refused on a post that was taken back', () => {
    post('api', 'ship it');
    remove('api');

    expect(edit('api', 'hold off')).toStrictEqual({ ok: false, reason: 'removed' });
  });

  it('is refused over 4,000 chars', () => {
    post('api', 'ship it');

    expect(edit('api', 'x'.repeat(4001))).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('is refused for a muted member, a closed room and a stranger', () => {
    post('api', 'ship it');
    store().muteMember({ by: 'human', member: 'api', muted: true, room: 'demo' });

    expect(edit('api', 'hold off')).toStrictEqual({ ok: false, reason: 'muted' });
    expect(edit('nobody', 'hold off')).toStrictEqual({ ok: false, reason: 'not_member' });
    expect(store().editPost({ as: 'api', room: 'nope', text: 'x' })).toStrictEqual({ ok: false, reason: 'no_room' });
  });

  it('finds the new text in search and not the old', () => {
    const sent = post('api', 'zebra crossing');
    edit('api', 'giraffe crossing');

    expect([search('giraffe'), search('zebra')]).toStrictEqual([[sent.id], []]);
  });

  it('survives a restart with the edit and the event replayable', () => {
    const sent = post('api', 'ship it');
    edit('api', 'hold off');
    scratch.reopen();

    expect(scratch.store.listMessages({ limit: 10, room: 'demo' })).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ id: sent.id, text: 'hold off' })]),
    });
    expect(scratch.store.events.since(0).map(({ event }) => event.type)).toContain('message_edit');
  });
});

describe('removePost', () => {
  it('blanks the text, marks it removed and emits message_edit', () => {
    const sent = post('api', 'ship it @web');
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = remove('api');

    expect(result).toMatchObject({
      message: { id: sent.id, mentions: [], removed_at: '2026-01-01T10:00:00.000Z', text: '' },
      ok: true,
    });
    expect(seen.map(({ event }) => event.type)).toStrictEqual(['message_edit']);
  });

  it('takes the post out of search', () => {
    post('api', 'zebra crossing');
    remove('api');

    expect(search('zebra')).toStrictEqual([]);
  });

  it('is refused after five minutes and when there is nothing to take back', () => {
    expect(remove('api')).toStrictEqual({ ok: false, reason: 'no_post' });
    post('api', 'ship it');
    scratch.clock.advance(5 * MINUTE + 1);

    expect(remove('api')).toStrictEqual({ ok: false, reason: 'too_old' });
  });

  it('is refused twice in a row', () => {
    post('api', 'ship it');
    remove('api');

    expect(remove('api')).toStrictEqual({ ok: false, reason: 'removed' });
  });
});
