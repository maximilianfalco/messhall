import type { SequencedEvent } from '../../contracts/events.ts';
import type { RoomStore } from '../../src/rooms/store.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore, T0 } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;
const texts = (room: string) =>
  scratch.db
    .prepare(
      'select from_name, text from messages join rooms on rooms.id = messages.room_id where rooms.name = ? order by messages.id',
    )
    .all(room)
    .map(row => `${String(row.from_name)}: ${String(row.text)}`);
const memberOf = (room: string, name: string) =>
  store()
    .listMembers(room)
    .find(member => member.name === name);

function joinBoth(room = 'demo') {
  store().joinRoom({ as: 'api', kind: 'claude', room });
  store().joinRoom({ as: 'web', kind: 'codex', room });
}

function post(from: string, text: string, done?: boolean) {
  const result = store().postMessage({ done, from, room: 'demo', text });
  if (!result.ok) throw new Error(`post failed: ${result.reason}`);
  return result.message;
}

describe('joinRoom', () => {
  it('creates the room on first join with the default cap and the human seat', () => {
    const result = store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(result.ok).toBe(true);
    expect(store().listRooms()).toMatchObject([{ closed_at: null, message_cap: 200, message_count: 0, name: 'demo' }]);
    expect(
      store()
        .listMembers('demo')
        .map(member => [member.name, member.kind]),
    ).toStrictEqual([
      ['api', 'claude'],
      ['human', 'human'],
    ]);
    expect(texts('demo')).toStrictEqual(['messhall: api joined']);
  });

  it('keeps the client name and version, labeled from the known clients', () => {
    store().joinRoom({ as: 'web', client: { name: 'opencode', version: '1.18.34' }, kind: 'other', room: 'demo' });

    expect(store().listMembers('demo')).toMatchObject([
      { client_label: null, client_name: null, client_version: null, name: 'human' },
      { client_label: 'opencode', client_name: 'opencode', client_version: '1.18.34', name: 'web' },
    ]);
  });

  it('labels an unknown client with the first word of its name', () => {
    store().joinRoom({ as: 'web', client: { name: 'Cursor Agent', version: '2.0' }, kind: 'other', room: 'demo' });

    expect(store().listMembers('demo')[1]).toMatchObject({ client_label: 'Cursor', client_name: 'Cursor Agent' });
  });

  it('takes the new client on a rejoin', () => {
    store().joinRoom({ as: 'web', client: { name: 'opencode', version: '1.18.34' }, kind: 'other', room: 'demo' });
    store().leaveRoom({ as: 'web', room: 'demo' });

    store().joinRoom({ as: 'web', client: { name: 'crush', version: '0.97.1' }, kind: 'other', room: 'demo' });

    expect(store().listMembers('demo')[1]).toMatchObject({ client_name: 'crush', client_version: '0.97.1' });
  });

  it('rejects a second live member with the same name and suggests another', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(store().joinRoom({ as: 'api', kind: 'codex', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'name_taken',
      suggestion: 'api-2',
    });
  });

  it.each(['human', 'messhall', 'all'])('refuses the reserved name %s', name => {
    expect(store().joinRoom({ as: name, kind: 'claude', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'name_reserved',
    });
  });

  it('takes over a gone name and keeps its cursor', () => {
    joinBoth();
    post('web', 'one');
    store().readUnseen({ as: 'api', room: 'demo' });
    const cursor = memberOf('demo', 'api')!.cursor;
    store().touch({ as: 'api', room: 'demo', state: 'gone' });

    const result = store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(result).toMatchObject({ change: 'reconnected', ok: true });
    expect(memberOf('demo', 'api')).toMatchObject({ cursor, presence: 'active' });
    expect(texts('demo').at(-1)).toBe('messhall: api reconnected');
  });

  it('takes over a live name when the holder session is dead and keeps its cursor', () => {
    joinBoth();
    post('web', 'one');
    store().readUnseen({ as: 'api', room: 'demo' });
    const cursor = memberOf('demo', 'api')!.cursor;

    const result = store().joinRoom({ as: 'api', holderDead: true, kind: 'claude', room: 'demo' });

    expect(result).toMatchObject({ change: 'reconnected', ok: true });
    expect(memberOf('demo', 'api')).toMatchObject({ cursor, presence: 'active' });
    expect(texts('demo').at(-1)).toBe('messhall: api reconnected');
  });

  it('lets a member who left join again', () => {
    joinBoth();
    store().leaveRoom({ as: 'api', room: 'demo' });

    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' })).toMatchObject({ change: 'joined', ok: true });
    expect(memberOf('demo', 'api')!.left_at).toBeNull();
  });
});

describe('postMessage', () => {
  it('refuses a caller who has not joined', () => {
    joinBoth();

    expect(store().postMessage({ from: 'infra', room: 'demo', text: 'hi' })).toStrictEqual({
      ok: false,
      reason: 'not_member',
    });
    expect(store().postMessage({ from: 'api', room: 'nope', text: 'hi' })).toStrictEqual({
      ok: false,
      reason: 'no_room',
    });
  });

  it('refuses text over 4,000 chars and keeps text at the cap', () => {
    joinBoth();

    expect(store().postMessage({ from: 'api', room: 'demo', text: 'x'.repeat(4001) })).toStrictEqual({
      length: 4001,
      ok: false,
      reason: 'too_long',
    });
    expect(store().postMessage({ from: 'api', room: 'demo', text: 'x'.repeat(4000) }).ok).toBe(true);
  });

  it('stamps each post with the sender kind and client label, and daemon lines with none', () => {
    store().joinRoom({ as: 'web', client: { name: 'opencode', version: '1.18.34' }, kind: 'other', room: 'demo' });
    const message = post('web', 'hi');
    store().leaveRoom({ as: 'web', room: 'demo' });

    expect(message).toMatchObject({ from_client_label: 'opencode', from_kind: 'other' });
    expect(
      store()
        .listMessages({ limit: 10, room: 'demo' })
        .messages?.map(item => [item.from, item.from_kind, item.from_client_label]),
    ).toStrictEqual([
      ['messhall', null, null],
      ['web', 'other', 'opencode'],
      ['messhall', null, null],
    ]);
  });

  it('stamps a human post with kind human and no label', () => {
    store().createRoom({ created_by: 'human', name: 'demo' });

    expect(post('human', 'hi')).toMatchObject({ from_client_label: null, from_kind: 'human' });
  });

  it('parses mentions against current members only', () => {
    joinBoth();
    store().joinRoom({ as: 'infra', kind: 'other', room: 'demo' });
    store().leaveRoom({ as: 'infra', room: 'demo' });

    expect(post('api', '@web and @infra and @ghost, mail a@b.com').mentions).toStrictEqual(['web']);
    expect(post('api', '@all wrap up').mentions).toStrictEqual(['all']);
  });

  it('warns at 160 posts and closes the room at 200', () => {
    joinBoth();
    Array.from({ length: 199 }, (_, index) => post(index % 2 ? 'web' : 'api', `m${index}`));

    expect(texts('demo')).toContain('messhall: #demo is at 160/200, wrap up');
    expect(store().listRooms()[0]!.closed_at).toBeNull();

    post('web', 'm199');

    expect(texts('demo').at(-1)).toBe('messhall: #demo reached its cap of 200 and is closed. ask the human to reopen');
    expect(store().listRooms()[0]).toMatchObject({ closed_at: expect.any(String), message_count: 200 });
    expect(store().postMessage({ from: 'api', room: 'demo', text: 'one more' })).toStrictEqual({
      ok: false,
      reason: 'room_full',
    });
  });

  it('closes the room when the last agent is done and lets a later post put a member back in', () => {
    joinBoth();
    post('api', 'my part is in', true);

    expect(memberOf('demo', 'api')!.done).toBe(true);

    post('api', 'one more thing');

    expect(memberOf('demo', 'api')!.done).toBe(false);

    post('api', 'done now', true);
    const last = post('web', 'done too', true);

    expect(last.kind).toBe('done');
    expect(texts('demo').at(-1)).toBe('messhall: all done, room closed');
    expect(store().postMessage({ from: 'api', room: 'demo', text: 'wait' })).toStrictEqual({
      ok: false,
      reason: 'room_closed',
    });
  });

  it('reopens a closed room when the human posts', () => {
    joinBoth();
    post('api', 'done', true);
    post('web', 'done', true);

    post('human', '@web one more fix please');

    expect(store().listRooms()[0]).toMatchObject({ closed_at: null, message_cap: 202 });
    expect(texts('demo').slice(-2)).toStrictEqual([
      'messhall: #demo reopened, 200 more posts',
      'human: @web one more fix please',
    ]);
    expect(store().postMessage({ from: 'web', room: 'demo', text: 'on it' }).ok).toBe(true);
  });
});

describe('readUnseen', () => {
  it('returns messages after the cursor, skips the reader own, and moves the cursor', () => {
    joinBoth();
    store().readUnseen({ as: 'api', room: 'demo' });
    post('api', 'from api');
    post('web', 'from web');

    const first = store().readUnseen({ as: 'api', room: 'demo' });
    const second = store().readUnseen({ as: 'api', room: 'demo' });

    expect(first.ok && first.messages.map(message => message.text)).toStrictEqual(['from web']);
    expect(second).toStrictEqual({ messages: [], more: false, ok: true });
  });

  it('caps a read at 50 and says there is more', () => {
    joinBoth();
    Array.from({ length: 60 }, (_, index) => post('web', `m${index}`));

    const first = store().readUnseen({ as: 'api', limit: 500, room: 'demo' });
    const second = store().readUnseen({ as: 'api', room: 'demo' });

    expect(first.ok && [first.messages.length, first.more]).toStrictEqual([50, true]);
    expect(second.ok && [second.messages.length, second.more]).toStrictEqual([12, false]);
  });

  it('reads from afterId without moving the cursor', () => {
    joinBoth();
    const one = post('web', 'one');
    post('web', 'two');
    store().readUnseen({ as: 'api', room: 'demo' });
    const cursor = memberOf('demo', 'api')!.cursor;

    const again = store().readUnseen({ afterId: one.id, as: 'api', room: 'demo' });

    expect(again.ok && again.messages.map(message => message.text)).toStrictEqual(['two']);
    expect(memberOf('demo', 'api')!.cursor).toBe(cursor);
  });

  it('refuses a reader who has not joined', () => {
    joinBoth();

    expect(store().readUnseen({ as: 'infra', room: 'demo' })).toStrictEqual({ ok: false, reason: 'not_member' });
  });
});

describe('the store on disk', () => {
  it('keeps messages and cursors across closing and opening the db', () => {
    joinBoth();
    post('web', 'kept');
    store().readUnseen({ as: 'api', room: 'demo' });
    const cursor = memberOf('demo', 'api')!.cursor;

    scratch.reopen();

    expect(texts('demo')).toContain('web: kept');
    expect(memberOf('demo', 'api')!.cursor).toBe(cursor);
  });
});

describe('presence', () => {
  const minutes = (count: number) => count * 60_000;

  it('moves active to idle to gone with the clock and posts a line on gone', () => {
    joinBoth();

    scratch.clock.advance(minutes(2));
    expect(store().sweepPresence()).toStrictEqual([
      { from: 'active', name: 'api', room: 'demo', to: 'idle' },
      { from: 'active', name: 'web', room: 'demo', to: 'idle' },
    ]);

    store().touch({ as: 'web', room: 'demo', state: 'active' });
    scratch.clock.advance(minutes(29));
    expect(store().sweepPresence()).toStrictEqual([
      { from: 'idle', name: 'api', room: 'demo', to: 'gone' },
      { from: 'active', name: 'web', room: 'demo', to: 'idle' },
    ]);
    expect(memberOf('demo', 'human')!.presence).toBe('idle');
    expect(texts('demo').at(-1)).toBe('messhall: api is gone');
  });

  it('holds waiting until 30 minutes of silence', () => {
    joinBoth();
    store().touch({ as: 'web', room: 'demo', state: 'waiting' });

    scratch.clock.advance(minutes(10));
    store().sweepPresence();

    expect(memberOf('demo', 'web')!.presence).toBe('waiting');
  });

  it('marks every member still in a room gone after a restart, with one line per open room', () => {
    joinBoth();
    store().joinRoom({ as: 'ios', kind: 'other', room: 'demo' });
    store().leaveRoom({ as: 'ios', room: 'demo' });
    joinBoth('old');
    store().closeRoom('old');
    store().touch({ as: 'web', room: 'old', state: 'gone' });
    const before = texts('old').length;

    const changes = store().markAllGone();

    expect(changes).toStrictEqual([
      { from: 'active', name: 'api', room: 'demo', to: 'gone' },
      { from: 'active', name: 'web', room: 'demo', to: 'gone' },
      { from: 'active', name: 'api', room: 'old', to: 'gone' },
    ]);
    expect(
      store()
        .listMembers('demo')
        .map(member => [member.name, member.presence]),
    ).toStrictEqual([
      ['api', 'gone'],
      ['human', 'idle'],
      ['web', 'gone'],
    ]);
    expect(texts('demo').at(-1)).toBe('messhall: messhall restarted, api and web are gone');
    expect(texts('old')).toHaveLength(before);
    expect(store().markAllGone()).toStrictEqual([]);
  });

  it('emits a presence event for each change', () => {
    joinBoth();
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    store().touch({ as: 'web', room: 'demo', state: 'waiting' });
    store().touch({ as: 'web', room: 'demo', state: 'waiting' });

    expect(seen.map(item => item.event)).toStrictEqual([
      { from: 'active', name: 'web', room: 'demo', to: 'waiting', type: 'presence' },
    ]);
  });
});

describe('listing', () => {
  it('lists rooms with their counted posts and members still in the room', () => {
    joinBoth('one');
    joinBoth('two');
    store().postMessage({ from: 'api', room: 'two', text: 'hi' });
    store().leaveRoom({ as: 'web', note: 'shipping', room: 'two' });

    expect(
      store()
        .listRooms()
        .map(room => [room.name, room.message_count]),
    ).toStrictEqual([
      ['one', 0],
      ['two', 1],
    ]);
    expect(
      store()
        .listMembers('two')
        .map(member => member.name),
    ).toStrictEqual(['api', 'human']);
    expect(texts('two').at(-1)).toBe('messhall: web left: shipping');
  });

  it('adds the human seat only once', () => {
    joinBoth();

    store().ensureHuman('demo');

    expect(
      store()
        .listMembers('demo')
        .filter(member => member.kind === 'human'),
    ).toHaveLength(1);
  });

  it('reopens a room with a full cap', () => {
    joinBoth();
    expect(store().reopenRoom('demo')).toStrictEqual({ ok: false, reason: 'open' });
    post('api', 'done', true);
    post('web', 'done', true);

    const result = store().reopenRoom('demo');

    expect(result.ok && result.room).toMatchObject({ closed_at: null, message_cap: 202 });
  });
});

describe('listMessages', () => {
  const ids = (result: ReturnType<RoomStore['listMessages']>) => (result.ok ? result.messages.map(m => m.text) : []);

  function seed() {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    return ['one', 'two', 'three', 'four'].map(text => post('api', text).id);
  }

  it('returns the latest messages oldest first when no after is given', () => {
    seed();

    expect(ids(store().listMessages({ limit: 2, room: 'demo' }))).toStrictEqual(['three', 'four']);
  });

  it('returns the page after an id without moving any cursor', () => {
    const [first] = seed();
    const before = memberOf('demo', 'api')?.cursor;

    expect(ids(store().listMessages({ after: first, limit: 2, room: 'demo' }))).toStrictEqual(['two', 'three']);
    expect(memberOf('demo', 'api')?.cursor).toBe(before);
  });

  it('includes system lines', () => {
    seed();

    expect(ids(store().listMessages({ after: 0, limit: 1, room: 'demo' }))).toStrictEqual(['api joined']);
  });

  it('refuses a room that does not exist', () => {
    expect(store().listMessages({ limit: 5, room: 'nope' })).toStrictEqual({ ok: false, reason: 'no_room' });
  });
});

describe('human-made rooms', () => {
  const human = () => store().createRoom({ created_by: 'human', name: 'demo', topic: 'q4' });
  const changes = (seen: SequencedEvent[]) =>
    seen.flatMap(item => (item.event.type === 'room' ? [item.event.change] : []));

  it('makes a standing room with its topic, the default cap and the human seat, and emits room created', () => {
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = human();

    expect(result.ok && result.room).toMatchObject({
      closed_at: null,
      created_by: 'human',
      message_cap: 200,
      name: 'demo',
      standing: true,
      topic: 'q4',
    });
    expect(changes(seen)).toStrictEqual(['created']);
    expect(
      store()
        .listMembers('demo')
        .map(member => member.name),
    ).toStrictEqual(['human']);
  });

  it('takes a cap', () => {
    const result = store().createRoom({ cap: 5, created_by: 'human', name: 'demo' });

    expect(result.ok && result.room).toMatchObject({ message_cap: 5, topic: null });
  });

  it('refuses a name that already exists', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(human()).toStrictEqual({ ok: false, reason: 'exists' });
  });

  it('records the agent that made a room by joining it, not standing', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(store().listRooms()[0]).toMatchObject({ created_by: 'api', standing: false });
  });

  it('stays open after every agent posts done', () => {
    human();
    joinBoth();

    post('api', 'done', true);
    post('web', 'done', true);

    expect(store().listRooms()[0]!.closed_at).toBeNull();
    expect(texts('demo')).not.toContain('messhall: all done, room closed');
    expect(post('api', 'back again').kind).toBe('chat');
  });

  it('stays open after every agent leaves', () => {
    human();
    joinBoth();

    store().leaveRoom({ as: 'api', room: 'demo' });
    store().leaveRoom({ as: 'web', room: 'demo' });

    expect(store().listRooms()[0]!.closed_at).toBeNull();
  });

  it('still closes at its cap', () => {
    store().createRoom({ cap: 2, created_by: 'human', name: 'demo' });
    joinBoth();

    post('api', 'one');
    post('web', 'two');

    expect(store().listRooms()[0]!.closed_at).not.toBeNull();
    expect(texts('demo').at(-1)).toBe('messhall: #demo reached its cap of 2 and is closed. ask the human to reopen');
  });

  it('closes by hand with a system line and a room closed event', () => {
    human();
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = store().closeRoom('demo');

    expect(result.ok && result.room.closed_at).toBe(new Date(T0).toISOString());
    expect(texts('demo').at(-1)).toBe('messhall: #demo closed by the human');
    expect(changes(seen)).toStrictEqual(['closed']);
  });

  it('refuses to close a room that is closed or missing', () => {
    human();
    store().closeRoom('demo');

    expect(store().closeRoom('demo')).toStrictEqual({ ok: false, reason: 'closed' });
    expect(store().closeRoom('nope')).toStrictEqual({ ok: false, reason: 'no_room' });
  });

  it('keeps a closed room in the listing', () => {
    human();
    store().createRoom({ created_by: 'human', name: 'other' });
    store().closeRoom('demo');

    expect(
      store()
        .listRooms()
        .map(room => [room.name, room.closed_at !== null]),
    ).toStrictEqual([
      ['demo', true],
      ['other', false],
    ]);
  });

  it('refuses a join into a closed standing room until the human reopens it', () => {
    human();
    store().closeRoom('demo');

    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'room_closed',
    });

    store().reopenRoom('demo');

    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' }).ok).toBe(true);
  });
});

describe('summaries', () => {
  function summarize(text = 'Goal: cents.') {
    const coversId = Number(scratch.db.prepare('select max(id) as id from messages').get()?.id);
    const result = store().addSummary({ coversId, room: 'demo', text });
    if (!result.ok) throw new Error(result.reason);
    return result.message;
  }

  it('refuses a summary for a room that does not exist', () => {
    expect(store().addSummary({ coversId: 0, room: 'nope', text: 'x' })).toStrictEqual({
      ok: false,
      reason: 'no_room',
    });
  });

  it('stores a summary from messhall that the cap count leaves out', () => {
    joinBoth();
    post('api', 'hello');

    const summary = summarize();

    expect(summary).toMatchObject({ from: 'messhall', kind: 'summary', mentions: [], text: 'Goal: cents.' });
    expect(store().listRooms()[0]!.message_count).toBe(1);
    expect(store().latestSummary('demo')).toStrictEqual(summary);
  });

  it('never closes a room at its cap because of summaries', () => {
    joinBoth();
    Array.from({ length: 199 }, (_, index) => post(index % 2 ? 'web' : 'api', `m${index}`));

    summarize();

    expect(store().listRooms()[0]).toMatchObject({ closed_at: null, message_count: 199 });
  });

  it('starts a new member at the latest summary, so its first read is the summary and what came after', () => {
    joinBoth();
    post('api', 'old news');
    const summary = summarize();
    post('web', 'after the summary');

    store().joinRoom({ as: 'late', kind: 'claude', room: 'demo' });
    const read = store().readUnseen({ as: 'late', room: 'demo' });

    expect(read.ok && read.messages.map(item => item.text)).toStrictEqual([
      summary.text,
      'after the summary',
      'late joined',
    ]);
  });

  it('starts a new member at 0 in a room with no summary', () => {
    joinBoth();

    store().joinRoom({ as: 'late', kind: 'claude', room: 'demo' });

    expect(memberOf('demo', 'late')?.cursor).toBe(0);
  });

  it('reports the posts so far, where the last summary stands and the posts after it', () => {
    joinBoth();
    post('api', 'one');
    post('web', 'two');
    summarize('first');
    post('api', 'three');

    const state = store().summaryState('demo');

    expect(
      state.ok && { ...state, previous: state.previous?.text, messages: state.messages.map(m => m.text) },
    ).toMatchObject({
      count: 3,
      lastSummaryAt: 2,
      messages: ['three'],
      ok: true,
      previous: 'first',
    });
  });
});

describe('leaving', () => {
  const presenceOf = (name: string) =>
    scratch.db
      .prepare(
        'select presence from members join rooms on rooms.id = members.room_id where rooms.name = ? and members.name = ?',
      )
      .get('demo', name)?.presence;

  it('marks a member who left as left, not gone, in the row and the member event', () => {
    joinBoth();
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    store().leaveRoom({ as: 'api', room: 'demo' });

    expect(presenceOf('api')).toBe('left');
    expect(seen.map(item => item.event)).toContainEqual(
      expect.objectContaining({
        change: 'left',
        member: expect.objectContaining({ presence: 'left' }),
        type: 'member',
      }),
    );
    expect(texts('demo')).not.toContain('messhall: api is gone');
  });

  it('leaves a left member alone in the sweep', () => {
    joinBoth();
    store().leaveRoom({ as: 'api', room: 'demo' });

    scratch.clock.advance(31 * 60_000);
    const changes = store().sweepPresence();

    expect(changes.map(change => change.name)).toStrictEqual(['web']);
    expect(presenceOf('api')).toBe('left');
  });

  it('clears left when the member joins again', () => {
    joinBoth();
    store().leaveRoom({ as: 'api', room: 'demo' });

    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(presenceOf('api')).toBe('active');
  });
});

describe('searchMessages', () => {
  function seedTwoRooms() {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    store().joinRoom({ as: 'web', kind: 'codex', room: 'billing' });
    store().postMessage({ from: 'api', room: 'checkout', text: 'prices move to cents' });
    store().postMessage({ from: 'web', room: 'billing', text: 'invoices stay in dollars' });
    store().postMessage({ from: 'web', room: 'billing', text: 'ok, cents in billing too' });
  }
  const hits = (query: Parameters<RoomStore['searchMessages']>[0]) => {
    const result = store().searchMessages(query);
    return result.ok ? result.messages.map(message => [message.room, message.from, message.text]) : result.reason;
  };

  it('finds a word in every room, newest first, with the room name', () => {
    seedTwoRooms();

    expect(hits({ q: 'cents' })).toStrictEqual([
      ['billing', 'web', 'ok, cents in billing too'],
      ['checkout', 'api', 'prices move to cents'],
    ]);
  });

  it('keeps to one room when asked', () => {
    seedTwoRooms();

    expect(hits({ q: 'cents', room: 'checkout' })).toStrictEqual([['checkout', 'api', 'prices move to cents']]);
  });

  it('matches word starts, any case, and needs every word', () => {
    seedTwoRooms();

    expect(hits({ q: 'CENT billing' })).toStrictEqual([['billing', 'web', 'ok, cents in billing too']]);
  });

  it('takes at most limit hits', () => {
    seedTwoRooms();

    expect(hits({ limit: 1, q: 'cents' })).toStrictEqual([['billing', 'web', 'ok, cents in billing too']]);
  });

  it.each(['"', 'cents AND', 'NEAR(', '*', '  '])('treats %j as plain text and never throws', q => {
    seedTwoRooms();

    expect(() => store().searchMessages({ q })).not.toThrow();
  });

  it('finds nothing for a query with no words', () => {
    seedTwoRooms();

    expect(hits({ q: '-- ?' })).toStrictEqual([]);
  });

  it('says when the room does not exist', () => {
    seedTwoRooms();

    expect(hits({ q: 'cents', room: 'nope' })).toBe('no_room');
  });
});
