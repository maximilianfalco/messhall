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
  it('creates the room on first join with the human seat', () => {
    const result = store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(result.ok).toBe(true);
    expect(store().listRooms()).toMatchObject([{ closed_at: null, message_count: 0, name: 'demo' }]);
    expect(store().listRooms()[0]).not.toHaveProperty('message_cap');
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

  it('seats a member with observe as an observer, on a new seat and on a rejoin', () => {
    store().joinRoom({ as: 'watch', kind: 'claude', observe: true, room: 'demo' });
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    store().leaveRoom({ as: 'api', room: 'demo' });
    store().joinRoom({ as: 'api', kind: 'claude', observe: true, room: 'demo' });

    expect([memberOf('demo', 'watch')!.role, memberOf('demo', 'api')!.role]).toStrictEqual(['observer', 'observer']);
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

  it('takes over an away name with no seat key and keeps its cursor', () => {
    joinBoth();
    post('web', 'one');
    store().readUnseen({ as: 'api', room: 'demo' });
    const cursor = memberOf('demo', 'api')!.cursor;
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    const result = store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(result).toMatchObject({ change: 'reconnected', ok: true });
    expect(memberOf('demo', 'api')).toMatchObject({ cursor, presence: 'active' });
    expect(texts('demo').at(-1)).toBe('messhall: api reconnected');
  });

  it('hands an away seat back to the same seat key with its cursor and role', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });
    store().joinRoom({ as: 'web', kind: 'codex', room: 'demo' });
    post('web', 'one');
    store().readUnseen({ as: 'api', room: 'demo' });
    store().assignRole({ by: 'human', member: 'api', role: 'worker', room: 'demo' });
    const cursor = memberOf('demo', 'api')!.cursor;
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    const result = store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });

    expect(result).toMatchObject({ change: 'reconnected', ok: true });
    expect(memberOf('demo', 'api')).toMatchObject({ cursor, presence: 'active', role: 'worker' });
  });

  it('keeps the done mark when a seat key reattaches its seat', () => {
    joinBoth();
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });
    post('api', 'my part is in', true);
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    store().joinRoom({ as: 'api', kind: 'claude', reattach: true, room: 'demo', seatKey: 'seat-a' });

    expect(memberOf('demo', 'api')).toMatchObject({ done: true, presence: 'active' });
  });

  it('clears the done mark on a fresh join of the same seat', () => {
    joinBoth();
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });
    post('api', 'my part is in', true);
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });

    expect(memberOf('demo', 'api')!.done).toBe(false);
  });

  it('hands a live seat back to the same seat key, since the old session is the same agent', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });

    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' })).toMatchObject({
      change: 'reconnected',
      ok: true,
    });
  });

  it.each([
    ['another seat key', 'seat-b'],
    ['no seat key', undefined],
  ])('never hands an away seat to a caller with %s', (_label, seat) => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    expect(
      store().joinRoom({ as: 'api', holderDead: true, kind: 'claude', room: 'demo', seatKey: seat }),
    ).toStrictEqual({
      ok: false,
      reason: 'name_taken',
      suggestion: 'api-2',
    });
    expect(memberOf('demo', 'api')!.presence).toBe('away');
  });

  it('hands a keyless away seat to a caller with a seat key and keeps the key from then on', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' })).toMatchObject({
      change: 'reconnected',
      ok: true,
    });
    expect(store().seatsOf('seat-a')).toStrictEqual([{ kind: 'claude', name: 'api', room: 'demo' }]);
  });

  it('gives a new seat key to a name whose holder left', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });
    store().leaveRoom({ as: 'api', room: 'demo' });

    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-b' })).toMatchObject({
      change: 'joined',
      ok: true,
    });
    expect(store().seatsOf('seat-b')).toStrictEqual([{ kind: 'claude', name: 'api', room: 'demo' }]);
    expect(store().seatsOf('seat-a')).toStrictEqual([]);
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

describe('seatsOf', () => {
  it('lists the seats a key holds in every room, away ones too, but not left ones', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'seat-a' });
    store().joinRoom({ as: 'api', kind: 'claude', room: 'ops', seatKey: 'seat-a' });
    store().joinRoom({ as: 'old', kind: 'claude', room: 'past', seatKey: 'seat-a' });
    store().joinRoom({ as: 'web', kind: 'claude', room: 'demo', seatKey: 'seat-b' });
    store().touch({ as: 'api', room: 'ops', state: 'away' });
    store().leaveRoom({ as: 'old', room: 'past' });

    expect(store().seatsOf('seat-a')).toStrictEqual([
      { kind: 'claude', name: 'api', room: 'demo' },
      { kind: 'claude', name: 'api', room: 'ops' },
    ]);
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

  it('keeps a room open past 250 posts with no wrap up line', () => {
    joinBoth();
    Array.from({ length: 250 }, (_, index) => post(index % 2 ? 'web' : 'api', `m${index}`));

    expect(store().listRooms()[0]).toMatchObject({ closed_at: null, message_count: 250 });
    expect(texts('demo').filter(line => line.startsWith('messhall:'))).toStrictEqual([
      'messhall: api joined',
      'messhall: web joined',
      'messhall: @human api and web have traded 12 lines in 2 minutes with no one else, their doorbells are paused for 5 minutes or until one of them posts to @human',
    ]);
    expect(post('api', 'one more').kind).toBe('chat');
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

  it('closes the room when both agents are done with an observer still in it', () => {
    joinBoth();
    store().joinRoom({ as: 'watch', kind: 'claude', observe: true, room: 'demo' });

    post('api', 'done here', true);
    post('web', 'done too', true);

    expect(texts('demo').at(-1)).toBe('messhall: all done, room closed');
  });

  it('keeps a room open when only an observer is done', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    store().joinRoom({ as: 'watch', kind: 'claude', observe: true, room: 'demo' });

    post('watch', 'seen enough', true);

    expect(store().listRooms()[0]!.closed_at).toBeNull();
  });

  it('reopens a closed room when the human posts', () => {
    joinBoth();
    post('api', 'done', true);
    post('web', 'done', true);

    post('human', '@web one more fix please');

    expect(store().listRooms()[0]!.closed_at).toBeNull();
    expect(texts('demo').slice(-2)).toStrictEqual(['messhall: #demo reopened', 'human: @web one more fix please']);
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

  it('moves active to idle to away with the clock and posts a line on away', () => {
    joinBoth();

    scratch.clock.advance(minutes(2));
    expect(store().sweepPresence({ ringable: () => false })).toStrictEqual([
      { from: 'active', name: 'api', room: 'demo', to: 'idle' },
      { from: 'active', name: 'web', room: 'demo', to: 'idle' },
    ]);

    store().touch({ as: 'web', room: 'demo', state: 'active' });
    scratch.clock.advance(minutes(29));
    expect(store().sweepPresence({ ringable: () => false })).toStrictEqual([
      { from: 'idle', name: 'api', room: 'demo', to: 'away' },
      { from: 'active', name: 'web', room: 'demo', to: 'idle' },
    ]);
    expect(memberOf('demo', 'human')!.presence).toBe('idle');
    expect(texts('demo').at(-1)).toBe('messhall: api is away');
  });

  it('keeps a seat its doorbell can reach idle after 30 minutes, with no away line', () => {
    joinBoth();
    const ringable = ({ name, room }: { name: string; room: string }) => name === 'web' && room === 'demo';

    scratch.clock.advance(minutes(2));
    store().sweepPresence({ ringable });
    scratch.clock.advance(minutes(30));

    expect(store().sweepPresence({ ringable })).toStrictEqual([
      { from: 'idle', name: 'api', room: 'demo', to: 'away' },
    ]);
    expect(memberOf('demo', 'web')!.presence).toBe('idle');
    expect(texts('demo')).not.toContain('messhall: web is away');
  });

  it('holds waiting until 30 minutes of silence', () => {
    joinBoth();
    store().touch({ as: 'web', room: 'demo', state: 'waiting' });

    scratch.clock.advance(minutes(10));
    store().sweepPresence({ ringable: () => false });

    expect(memberOf('demo', 'web')!.presence).toBe('waiting');
  });

  it('marks every member still in a room away after a restart, with one line per open room', () => {
    joinBoth();
    store().joinRoom({ as: 'ios', kind: 'other', room: 'demo' });
    store().leaveRoom({ as: 'ios', room: 'demo' });
    joinBoth('old');
    store().closeRoom('old');
    store().touch({ as: 'web', room: 'old', state: 'away' });
    const before = texts('old').length;

    const changes = store().markAllAway();

    expect(changes).toStrictEqual([
      { from: 'active', name: 'api', room: 'demo', to: 'away' },
      { from: 'active', name: 'web', room: 'demo', to: 'away' },
      { from: 'active', name: 'api', room: 'old', to: 'away' },
    ]);
    expect(
      store()
        .listMembers('demo')
        .map(member => [member.name, member.presence]),
    ).toStrictEqual([
      ['api', 'away'],
      ['human', 'idle'],
      ['web', 'away'],
    ]);
    expect(texts('demo').at(-1)).toBe('messhall: messhall restarted, api and web are away');
    expect(texts('old')).toHaveLength(before);
    expect(store().markAllAway()).toStrictEqual([]);
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

  it('reopens a closed room', () => {
    joinBoth();
    expect(store().reopenRoom('demo')).toStrictEqual({ ok: false, reason: 'open' });
    post('api', 'done', true);
    post('web', 'done', true);

    const result = store().reopenRoom('demo');

    expect(result.ok && result.room).toMatchObject({ closed_at: null });
    expect(texts('demo').at(-1)).toBe('messhall: #demo reopened');
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

  it('makes a standing room with its topic and the human seat, and emits room created', () => {
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = human();

    expect(result.ok && result.room).toMatchObject({
      closed_at: null,
      created_by: 'human',
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

  it('stores a summary from messhall that the post count leaves out', () => {
    joinBoth();
    post('api', 'hello');

    const summary = summarize();

    expect(summary).toMatchObject({ from: 'messhall', kind: 'summary', mentions: [], text: 'Goal: cents.' });
    expect(store().listRooms()[0]!.message_count).toBe(1);
    expect(store().latestSummary('demo')).toStrictEqual(summary);
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

  it('marks a member who left as left, not away, in the row and the member event', () => {
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
    expect(texts('demo')).not.toContain('messhall: api is away');
  });

  it('leaves a left member alone in the sweep', () => {
    joinBoth();
    store().leaveRoom({ as: 'api', room: 'demo' });

    scratch.clock.advance(31 * 60_000);
    const changes = store().sweepPresence({ ringable: () => false });

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

describe('roles', () => {
  const roleOf = (name: string) => memberOf('demo', name)?.role;

  it('starts members unassigned and a member named orchestrator as orchestrator', () => {
    joinBoth();
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });

    expect(['api', 'web', 'orchestrator', 'human'].map(roleOf)).toStrictEqual([
      'unassigned',
      'unassigned',
      'orchestrator',
      'unassigned',
    ]);
  });

  it('lets the orchestrator assign a role and emits a member role event', () => {
    joinBoth();
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = store().assignRole({ by: 'orchestrator', member: 'api', role: 'reviewer', room: 'demo' });

    expect(result).toMatchObject({ member: { name: 'api', role: 'reviewer' }, ok: true });
    expect(roleOf('api')).toBe('reviewer');
    expect(seen.map(({ event }) => event)).toMatchObject([
      { change: 'role', member: { name: 'api', role: 'reviewer' }, room: 'demo', type: 'member' },
    ]);
  });

  it('lets the human seat assign a role', () => {
    joinBoth();

    expect(store().assignRole({ by: 'human', member: 'web', role: 'worker', room: 'demo' })).toMatchObject({
      ok: true,
    });
    expect(roleOf('web')).toBe('worker');
  });

  it('sets the role of a member who left, ready for its next join', () => {
    joinBoth();
    store().leaveRoom({ as: 'api', room: 'demo' });

    expect(store().assignRole({ by: 'human', member: 'api', role: 'worker', room: 'demo' })).toMatchObject({
      ok: true,
    });
    expect(
      store()
        .listMembers('demo', { left: true })
        .find(member => member.name === 'api')?.role,
    ).toBe('worker');
  });

  it('keeps a role across a leave and a later join', () => {
    joinBoth();
    store().assignRole({ by: 'human', member: 'api', role: 'reviewer', room: 'demo' });
    store().leaveRoom({ as: 'api', room: 'demo' });
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(roleOf('api')).toBe('reviewer');
  });

  it.each([
    [{ by: 'web', member: 'api', role: 'reviewer', room: 'demo' }, 'not_allowed'],
    [{ by: 'api', member: 'api', role: 'orchestrator', room: 'demo' }, 'not_allowed'],
    [{ by: 'stranger', member: 'api', role: 'reviewer', room: 'demo' }, 'not_member'],
    [{ by: 'human', member: 'ghost', role: 'reviewer', room: 'demo' }, 'no_member'],
    [{ by: 'human', member: 'api', role: 'reviewer', room: 'nope' }, 'no_room'],
  ])('refuses %o with %s', (input, reason) => {
    joinBoth();

    expect(store().assignRole(input)).toStrictEqual({ ok: false, reason });
    expect(roleOf('api')).toBe('unassigned');
  });
});

describe('role instructions', () => {
  it('stores the instructions and who set them with the role', () => {
    joinBoth();
    store().assignRole({
      by: 'human',
      instructions: 'review PRs that mention you',
      member: 'api',
      role: 'reviewer',
      room: 'demo',
    });

    expect(store().roleOf({ name: 'api', room: 'demo' })).toStrictEqual({
      by: 'human',
      instructions: 'review PRs that mention you',
      role: 'reviewer',
    });
  });

  it('replaces the instructions on the next assign, none when left out', () => {
    joinBoth();
    store().assignRole({ by: 'human', instructions: 'review', member: 'api', role: 'reviewer', room: 'demo' });
    store().assignRole({ by: 'human', member: 'api', role: 'observer', room: 'demo' });

    expect(store().roleOf({ name: 'api', room: 'demo' })).toStrictEqual({
      by: 'human',
      instructions: null,
      role: 'observer',
    });
  });

  it('gives a fresh member unassigned with no instructions, and nothing for a stranger', () => {
    joinBoth();

    expect(store().roleOf({ name: 'web', room: 'demo' })).toStrictEqual({
      by: null,
      instructions: null,
      role: 'unassigned',
    });
    expect(store().roleOf({ name: 'ghost', room: 'demo' })).toBeUndefined();
    expect(store().roleOf({ name: 'web', room: 'nope' })).toBeUndefined();
  });
});

describe('clearing stale members', () => {
  const minutes = (count: number) => count * 60_000;
  const names = (room = 'demo') =>
    store()
      .listMembers(room, { left: true })
      .map(member => member.name);

  it('drops a member left for 5 minutes and keeps its posts labeled', () => {
    joinBoth();
    post('api', 'shipped');
    store().leaveRoom({ as: 'api', room: 'demo' });

    scratch.clock.advance(minutes(4));
    expect(store().clearStale()).toStrictEqual([]);
    scratch.clock.advance(minutes(1));
    expect(store().clearStale()).toStrictEqual([{ name: 'api', room: 'demo' }]);

    expect(names()).toStrictEqual(['human', 'web']);
    const page = store().listMessages({ limit: 50, room: 'demo' });
    expect(page.ok && page.messages.find(message => message.text === 'shipped')).toMatchObject({
      from: 'api',
      from_kind: 'claude',
    });
  });

  it('never drops an away member, however long it stays away', () => {
    joinBoth();
    store().touch({ as: 'api', room: 'demo', state: 'away' });

    scratch.clock.advance(minutes(24 * 60));

    expect(store().clearStale()).toStrictEqual([]);
    expect(names()).toStrictEqual(['api', 'human', 'web']);
  });

  it('never drops the human seat or a live member', () => {
    joinBoth();
    store().touch({ as: 'web', room: 'demo', state: 'waiting' });

    scratch.clock.advance(minutes(4));
    store().touch({ as: 'web', room: 'demo', state: 'waiting' });
    store().touch({ as: 'api', room: 'demo', state: 'active' });
    scratch.clock.advance(minutes(2));

    expect(store().clearStale()).toStrictEqual([]);
    expect(names()).toStrictEqual(['api', 'human', 'web']);
  });

  it('emits a removed member event for each member it drops', () => {
    joinBoth();
    store().leaveRoom({ as: 'api', room: 'demo' });
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    scratch.clock.advance(minutes(5));
    store().clearStale();

    expect(seen.map(item => item.event)).toStrictEqual([
      {
        change: 'removed',
        member: expect.objectContaining({ name: 'api', presence: 'left' }),
        room: 'demo',
        type: 'member',
      },
    ]);
  });

  it('starts a fresh member row on a rejoin under the same name', () => {
    joinBoth();
    post('web', 'one');
    store().readUnseen({ as: 'api', room: 'demo' });
    store().assignRole({ by: 'human', member: 'api', role: 'reviewer', room: 'demo' });
    store().leaveRoom({ as: 'api', room: 'demo' });
    scratch.clock.advance(minutes(5));
    store().clearStale();

    const result = store().joinRoom({ as: 'api', kind: 'codex', room: 'demo' });

    expect(result).toMatchObject({ change: 'joined', ok: true });
    expect(memberOf('demo', 'api')).toMatchObject({
      cursor: 0,
      joined_at: new Date(T0 + minutes(5)).toISOString(),
      kind: 'codex',
      role: 'unassigned',
    });
  });

  it('keeps only the live members of a standing room after many agents left', () => {
    store().createRoom({ created_by: 'human', name: 'lobby' });
    Array.from({ length: 35 }, (_, n) => `agent-${n}`).forEach(as => {
      store().joinRoom({ as, kind: 'claude', room: 'lobby' });
      store().leaveRoom({ as, room: 'lobby' });
    });
    scratch.clock.advance(minutes(5));
    store().joinRoom({ as: 'api', kind: 'claude', room: 'lobby' });

    expect(store().clearStale()).toHaveLength(35);
    expect(names('lobby')).toStrictEqual(['api', 'human']);
  });
});

describe('removing a member by hand', () => {
  const names = () =>
    store()
      .listMembers('demo', { left: true })
      .map(member => member.name);

  it('drops a left member right away and keeps its posts labeled', () => {
    joinBoth();
    post('api', 'shipped');
    store().leaveRoom({ as: 'api', room: 'demo' });

    const result = store().removeMember({ member: 'api', room: 'demo' });

    expect(result).toMatchObject({ member: { name: 'api', presence: 'left' }, ok: true });
    expect(names()).toStrictEqual(['human', 'web']);
    const page = store().listMessages({ limit: 50, room: 'demo' });
    expect(page.ok && page.messages.find(message => message.text === 'shipped')).toMatchObject({
      from: 'api',
      from_kind: 'claude',
    });
  });

  it('drops an away member and emits a removed member event', () => {
    joinBoth();
    store().touch({ as: 'api', room: 'demo', state: 'away' });
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    store().removeMember({ member: 'api', room: 'demo' });

    expect(seen.map(item => item.event)).toStrictEqual([
      {
        change: 'removed',
        member: expect.objectContaining({ name: 'api', presence: 'away' }),
        room: 'demo',
        type: 'member',
      },
    ]);
  });

  it('drops a member that is still here, since a kick ends any seat', () => {
    joinBoth();

    expect(store().removeMember({ member: 'api', room: 'demo' })).toMatchObject({
      member: { name: 'api', presence: 'active' },
      ok: true,
    });
    expect(names()).toStrictEqual(['human', 'web']);
  });

  it('refuses the human seat', () => {
    joinBoth();

    expect(store().removeMember({ member: 'human', room: 'demo' })).toStrictEqual({ ok: false, reason: 'human' });
    expect(names()).toStrictEqual(['api', 'human', 'web']);
  });

  it('refuses a member or a room that does not exist', () => {
    joinBoth();

    expect(store().removeMember({ member: 'ghost', room: 'demo' })).toStrictEqual({ ok: false, reason: 'no_member' });
    expect(store().removeMember({ member: 'api', room: 'nope' })).toStrictEqual({ ok: false, reason: 'no_room' });
  });
});

describe('kicking a member', () => {
  it('lets an orchestrator drop any agent seat with a line naming who kicked it', () => {
    joinBoth();
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });

    const result = store().kickMember({ by: 'orchestrator', member: 'api', room: 'demo' });

    expect(result).toMatchObject({ member: { name: 'api' }, ok: true });
    expect(memberOf('demo', 'api')).toBeUndefined();
    expect(texts('demo').at(-1)).toBe('messhall: api was kicked by orchestrator');
  });

  it('refuses a caller who is not an orchestrator before anything changes', () => {
    joinBoth();

    expect(store().kickMember({ by: 'web', member: 'api', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(memberOf('demo', 'api')).toBeDefined();
  });

  it('refuses the human seat and a missing member', () => {
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });

    expect(store().kickMember({ by: 'orchestrator', member: 'human', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'human',
    });
    expect(store().kickMember({ by: 'orchestrator', member: 'ghost', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'no_member',
    });
  });
});

describe('the loop guard', () => {
  const trade = (count: number, gapMs = 0) =>
    Array.from({ length: count }, (_, index) => {
      scratch.clock.advance(gapMs);
      return post(index % 2 ? 'web' : 'api', `line ${index + 1}`);
    });
  const loopLines = () => texts('demo').filter(line => line.includes('traded'));

  it('pauses two agents after 12 lines alone in 2 minutes and asks the human in one line', () => {
    joinBoth();

    trade(11, 5000);
    expect(store().pausedWith('demo')).toStrictEqual({});

    trade(1, 5000);
    expect(store().pausedWith('demo')).toStrictEqual({ api: 'web', web: 'api' });
    expect(loopLines()).toStrictEqual([
      'messhall: @human api and web have traded 12 lines in 2 minutes with no one else, their doorbells are paused for 5 minutes or until one of them posts to @human',
    ]);
    expect(store().listMessages({ limit: 1, room: 'demo' }).messages?.[0]?.mentions).toStrictEqual(['human']);
  });

  it('leaves a discussion of 12 lines over 20 minutes alone', () => {
    joinBoth();

    trade(12, 100_000);

    expect(store().pausedWith('demo')).toStrictEqual({});
    expect(loopLines()).toStrictEqual([]);
  });

  it('pauses a slow pair after 40 lines alone', () => {
    joinBoth();

    trade(40, 100_000);

    expect(store().pausedWith('demo')).toStrictEqual({ api: 'web', web: 'api' });
    expect(loopLines()).toStrictEqual([
      'messhall: @human api and web have traded 40 lines with no one else, their doorbells are paused for 5 minutes or until one of them posts to @human',
    ]);
  });

  it('says it once while the pair stays paused', () => {
    joinBoth();

    trade(30);

    expect(loopLines()).toHaveLength(1);
  });

  it('restarts the run when a third agent speaks', () => {
    joinBoth();
    store().joinRoom({ as: 'infra', kind: 'claude', room: 'demo' });

    trade(6);
    post('infra', 'hi both');
    trade(6);

    expect(store().pausedWith('demo')).toStrictEqual({});
    expect(loopLines()).toStrictEqual([]);
  });

  it('lifts the pause when the human posts, and pauses again after 12 more', () => {
    joinBoth();
    trade(12);

    post('human', 'stop and sum up');
    expect(store().pausedWith('demo')).toStrictEqual({});

    trade(12);
    expect(store().pausedWith('demo')).toStrictEqual({ api: 'web', web: 'api' });
    expect(loopLines()).toHaveLength(2);
  });

  it('lifts the pause when one of the pair posts to the human, and counts afresh after it', () => {
    joinBoth();
    trade(12);

    post('web', '@human we are settling the totals field, it needs a few more lines');
    expect(store().pausedWith('demo')).toStrictEqual({});

    trade(11);
    expect(store().pausedWith('demo')).toStrictEqual({});
    expect(loopLines()).toHaveLength(1);
  });

  it('ends due pauses on the sweep and hands back the partner line each of the pair has not read', () => {
    joinBoth();
    trade(12);
    store().readUnseen({ as: 'api', room: 'demo' });
    const missed = post('web', '@api your turn');

    scratch.clock.advance(5 * 60_000 - 1);
    expect(store().endPauses()).toStrictEqual([]);
    scratch.clock.advance(1);
    expect(store().endPauses()).toStrictEqual([
      { message: missed, room: 'demo' },
      { message: expect.objectContaining({ from: 'api', text: 'line 11' }), room: 'demo' },
    ]);
    expect(store().endPauses()).toStrictEqual([]);
    expect(store().pausedWith('demo')).toStrictEqual({});
  });

  it('ends the pause by itself after 5 minutes, and counts afresh after it', () => {
    joinBoth();
    trade(12);

    scratch.clock.advance(5 * 60_000 - 1);
    expect(store().pausedWith('demo')).toStrictEqual({ api: 'web', web: 'api' });
    scratch.clock.advance(1);
    expect(store().pausedWith('demo')).toStrictEqual({});

    trade(11);
    expect(store().pausedWith('demo')).toStrictEqual({});
    trade(1);
    expect(store().pausedWith('demo')).toStrictEqual({ api: 'web', web: 'api' });
    expect(loopLines()).toHaveLength(2);
  });
});

describe('muting', () => {
  const mute = (input: { by: string; member: string; muted?: boolean }) =>
    store().muteMember({ muted: true, room: 'demo', ...input });

  it('lets the human mute a member, with a system line and a member muted event', () => {
    joinBoth();
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = mute({ by: 'human', member: 'api' });

    expect(result).toMatchObject({ member: { muted: true, name: 'api' }, ok: true });
    expect(memberOf('demo', 'api')?.muted).toBe(true);
    expect(texts('demo').at(-1)).toBe('messhall: api muted by human');
    expect(seen.map(({ event }) => event)).toMatchObject([
      { change: 'muted', member: { muted: true, name: 'api' }, type: 'member' },
      { message: { kind: 'system', text: 'api muted by human' }, type: 'message' },
    ]);
  });

  it('lets an orchestrator mute and unmute a member', () => {
    joinBoth();
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });

    mute({ by: 'orchestrator', member: 'web' });
    const result = mute({ by: 'orchestrator', member: 'web', muted: false });

    expect(result).toMatchObject({ member: { muted: false, name: 'web' }, ok: true });
    expect(texts('demo').slice(-2)).toStrictEqual([
      'messhall: web muted by orchestrator',
      'messhall: web unmuted by orchestrator',
    ]);
  });

  it('refuses posts from a muted member, done posts too, and keeps it reading', () => {
    joinBoth();
    mute({ by: 'human', member: 'api' });
    post('web', 'still here');

    expect(store().postMessage({ from: 'api', room: 'demo', text: 'hello' })).toStrictEqual({
      ok: false,
      reason: 'muted',
    });
    expect(store().postMessage({ done: true, from: 'api', room: 'demo', text: 'done' })).toMatchObject({
      reason: 'muted',
    });
    expect(store().readUnseen({ as: 'api', room: 'demo' })).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ text: 'still here' })]),
      ok: true,
    });
  });

  it('lets an unmuted member post again', () => {
    joinBoth();
    mute({ by: 'human', member: 'api' });
    mute({ by: 'human', member: 'api', muted: false });

    expect(store().postMessage({ from: 'api', room: 'demo', text: 'back' }).ok).toBe(true);
  });

  it('keeps the mute across a leave and a later join', () => {
    joinBoth();
    mute({ by: 'human', member: 'api' });
    store().leaveRoom({ as: 'api', room: 'demo' });
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(memberOf('demo', 'api')?.muted).toBe(true);
  });

  it('writes nothing when the member is already in that state', () => {
    joinBoth();
    mute({ by: 'human', member: 'api' });
    const before = texts('demo');

    expect(mute({ by: 'human', member: 'api' })).toMatchObject({ ok: true });
    expect(mute({ by: 'human', member: 'web', muted: false })).toMatchObject({ ok: true });
    expect(texts('demo')).toStrictEqual(before);
  });

  it.each([
    [{ by: 'web', member: 'api' }, 'not_allowed'],
    [{ by: 'api', member: 'api' }, 'not_allowed'],
    [{ by: 'stranger', member: 'api' }, 'not_member'],
    [{ by: 'human', member: 'ghost' }, 'no_member'],
    [{ by: 'human', member: 'human' }, 'human'],
  ])('refuses %o with %s', (input, reason) => {
    joinBoth();

    expect(mute(input)).toStrictEqual({ ok: false, reason });
    expect(memberOf('demo', 'api')?.muted).toBe(false);
  });

  it('refuses a muted orchestrator, so it cannot lift its own mute or mute others', () => {
    joinBoth();
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });
    mute({ by: 'human', member: 'orchestrator' });

    expect(mute({ by: 'orchestrator', member: 'orchestrator', muted: false })).toStrictEqual({
      ok: false,
      reason: 'muted',
    });
    expect(mute({ by: 'orchestrator', member: 'api' })).toStrictEqual({ ok: false, reason: 'muted' });
    expect(memberOf('demo', 'orchestrator')?.muted).toBe(true);
    expect(memberOf('demo', 'api')?.muted).toBe(false);
  });

  it('refuses a room that does not exist', () => {
    expect(store().muteMember({ by: 'human', member: 'api', muted: true, room: 'nope' })).toStrictEqual({
      ok: false,
      reason: 'no_room',
    });
  });
});

describe('topics', () => {
  const topicOf = (room: string) =>
    store()
      .listRooms()
      .find(item => item.name === room)?.topic;
  const setTopic = (input: { by: string; topic?: string }) =>
    store().setTopic({ room: 'demo', topic: 'checkout totals in cents', ...input });

  it('sets the topic on the join that makes the room', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', topic: 'checkout totals in cents' });

    expect(topicOf('demo')).toBe('checkout totals in cents');
  });

  it('ignores the topic on a later join', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', topic: 'first' });
    store().joinRoom({ as: 'web', kind: 'codex', room: 'demo', topic: 'second' });

    expect(topicOf('demo')).toBe('first');
  });

  it('lets the maker set it, with a system line and a room topic event', () => {
    joinBoth();
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const result = setTopic({ by: 'api' });

    expect(result).toMatchObject({ ok: true, room: { topic: 'checkout totals in cents' } });
    expect(topicOf('demo')).toBe('checkout totals in cents');
    expect(texts('demo').at(-1)).toBe('messhall: topic set by api: checkout totals in cents');
    expect(seen.map(({ event }) => event)).toMatchObject([
      { change: 'topic', room: { topic: 'checkout totals in cents' }, type: 'room' },
      { message: { kind: 'system' }, type: 'message' },
    ]);
  });

  it.each(['orchestrator', 'human'])('lets %s set it', by => {
    joinBoth();
    store().joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });

    expect(setTopic({ by })).toMatchObject({ ok: true });
    expect(topicOf('demo')).toBe('checkout totals in cents');
  });

  it('writes nothing when the topic is already that', () => {
    joinBoth();
    setTopic({ by: 'api' });
    const before = texts('demo');

    expect(setTopic({ by: 'api' })).toMatchObject({ ok: true });
    expect(texts('demo')).toStrictEqual(before);
  });

  it.each([
    [{ by: 'web' }, 'not_allowed'],
    [{ by: 'stranger' }, 'not_member'],
  ])('refuses %o with %s', (input, reason) => {
    joinBoth();

    expect(setTopic(input)).toStrictEqual({ ok: false, reason });
    expect(topicOf('demo')).toBeNull();
  });

  it('refuses a muted maker', () => {
    joinBoth();
    store().muteMember({ by: 'human', member: 'api', muted: true, room: 'demo' });

    expect(setTopic({ by: 'api' })).toStrictEqual({ ok: false, reason: 'muted' });
  });

  it('refuses a closed room', () => {
    joinBoth();
    post('api', 'done', true);
    post('web', 'done', true);

    expect(setTopic({ by: 'api' })).toStrictEqual({ ok: false, reason: 'room_closed' });
  });

  it('refuses a room that does not exist', () => {
    expect(store().setTopic({ by: 'api', room: 'nope', topic: 'x' })).toStrictEqual({ ok: false, reason: 'no_room' });
  });
});
