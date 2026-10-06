import type { Member, Message } from '../../contracts/room.ts';

import { describe, expect, it } from 'vitest';

import {
  canAssignRole,
  concerns,
  loopPair,
  missingMentions,
  nextPresence,
  parseMentions,
} from '../../src/rooms/rules.js';

const T0 = '2026-01-01T10:00:00.000Z';
const minutes = (count: number) => new Date(Date.parse(T0) + count * 60_000);

const member = (fields: Partial<Member> & Pick<Member, 'name'>): Member => ({
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
  presence: 'active',
  role: 'unassigned',
  room_id: 'r1',
  ...fields,
});

const message = (fields: Partial<Message> & Pick<Message, 'from'>): Message => ({
  created_at: T0,
  from_client_label: null,
  from_kind: null,
  id: 1,
  kind: 'chat',
  mentions: [],
  room_id: 'r1',
  text: 'hi',
  ...fields,
});

const ROOM = [member({ kind: 'human', name: 'human' }), member({ name: 'api' }), member({ name: 'web' })];

describe('parseMentions', () => {
  it.each([
    ['@web the schema moved', ['web']],
    ['@web, @api: look', ['web', 'api']],
    ['ping @web and @web again', ['web']],
    ['@all wrap up', ['all']],
    ['mail a@b.com or x@web.io', []],
    ['@ghost is not here', []],
    ['@WEB is not a name', []],
  ])('reads %j as %j', (text, expected) => {
    expect(parseMentions({ names: ['api', 'web', 'human'], text })).toStrictEqual(expected);
  });
});

describe('missingMentions', () => {
  it.each([
    ['@web the schema moved', []],
    ['@web and @ghost, look', ['ghost']],
    ['@ghost then @ghost and @mobile', ['ghost', 'mobile']],
    ['@all wrap up', []],
    ['mail a@b.com or x@ghost.io', []],
    ['no mentions here', []],
  ])('reads %j as %j', (text, expected) => {
    expect(missingMentions({ names: ['api', 'web', 'human'], text })).toStrictEqual(expected);
  });
});

describe('concerns', () => {
  const three = [...ROOM, member({ name: 'infra' })];

  it('concerns a mentioned member', () => {
    expect(
      concerns({
        pausedWith: {},
        member: three[2]!,
        members: three,
        message: message({ from: 'api', mentions: ['web'] }),
      }),
    ).toBe(true);
  });

  it('concerns everyone on @all', () => {
    const msg = message({ from: 'api', mentions: ['all'] });
    expect(
      three
        .filter(m => m.name !== 'api')
        .map(m => concerns({ pausedWith: {}, member: m, members: three, message: msg })),
    ).toStrictEqual([true, true, true]);
  });

  it('concerns everyone when the human posts', () => {
    expect(concerns({ pausedWith: {}, member: three[1]!, members: three, message: message({ from: 'human' }) })).toBe(
      true,
    );
  });

  it('concerns a muted member never, not even a mention or the human', () => {
    const muted = member({ muted: true, name: 'web' });
    const members = [...ROOM.slice(0, 2), muted];

    expect(
      [message({ from: 'api', mentions: ['web'] }), message({ from: 'human' })].map(msg =>
        concerns({ member: muted, members, message: msg, pausedWith: {} }),
      ),
    ).toStrictEqual([false, false]);
  });

  it('concerns the only other agent in a room of two', () => {
    expect(concerns({ pausedWith: {}, member: ROOM[2]!, members: ROOM, message: message({ from: 'api' }) })).toBe(true);
  });

  it('skips an unmentioned agent in a room of three', () => {
    expect(concerns({ pausedWith: {}, member: three[2]!, members: three, message: message({ from: 'api' }) })).toBe(
      false,
    );
  });

  it('skips the poster', () => {
    expect(
      concerns({
        pausedWith: {},
        member: ROOM[1]!,
        members: ROOM,
        message: message({ from: 'api', mentions: ['all'] }),
      }),
    ).toBe(false);
  });

  it('skips daemon lines', () => {
    expect(
      concerns({
        pausedWith: {},
        member: ROOM[1]!,
        members: ROOM,
        message: message({ from: 'messhall', kind: 'system' }),
      }),
    ).toBe(false);
  });

  it('skips summaries, even with a mention in them', () => {
    const summary = message({ from: 'messhall', kind: 'summary', mentions: ['web', 'all'] });
    expect(ROOM.map(m => concerns({ pausedWith: {}, member: m, members: ROOM, message: summary }))).toStrictEqual([
      false,
      false,
      false,
    ]);
  });

  it('counts only members still in the room', () => {
    const left = [...ROOM, member({ left_at: T0, name: 'infra' })];
    expect(concerns({ pausedWith: {}, member: left[2]!, members: left, message: message({ from: 'api' }) })).toBe(true);
  });
});

describe('concerns with a paused pair', () => {
  const three = [...ROOM, member({ name: 'infra' })];
  const pausedWith = { api: 'web', web: 'api' };

  it('skips a line between the paused pair, even a mention', () => {
    expect(
      concerns({ member: three[2]!, members: three, message: message({ from: 'api', mentions: ['web'] }), pausedWith }),
    ).toBe(false);
  });

  it('still concerns a paused member when a third agent mentions it', () => {
    expect(
      concerns({
        member: three[2]!,
        members: three,
        message: message({ from: 'infra', mentions: ['web'] }),
        pausedWith,
      }),
    ).toBe(true);
  });

  it('still concerns a paused member when the human posts', () => {
    expect(concerns({ member: three[2]!, members: three, message: message({ from: 'human' }), pausedWith })).toBe(true);
  });
});

describe('loopPair', () => {
  const run = (froms: string[]) => froms.map((from, index) => message({ from, id: index + 1 }));
  const traded = (count: number) => run(Array.from({ length: count }, (_, index) => (index % 2 ? 'web' : 'api')));

  it('names the two agents when the last lines are only theirs', () => {
    expect(loopPair({ lines: 12, posts: traded(12) })).toStrictEqual(['api', 'web']);
  });

  it('waits for the full run', () => {
    expect(loopPair({ lines: 12, posts: traded(11) })).toBeNull();
  });

  it('looks only at the last lines', () => {
    expect(loopPair({ lines: 12, posts: [...run(['infra']), ...traded(11)] })).toBeNull();
    expect(loopPair({ lines: 12, posts: [...run(['infra']), ...traded(12)] })).toStrictEqual(['api', 'web']);
  });

  it('resets on a third agent in the run', () => {
    const posts = traded(12);
    posts[6] = message({ from: 'infra', id: 7 });
    expect(loopPair({ lines: 12, posts })).toBeNull();
  });

  it('resets on a human line in the run', () => {
    const posts = traded(12);
    posts[6] = message({ from: 'human', id: 7 });
    expect(loopPair({ lines: 12, posts })).toBeNull();
  });

  it('resets on a done in the run', () => {
    const posts = traded(12);
    posts[6] = message({ from: 'api', id: 7, kind: 'done' });
    expect(loopPair({ lines: 12, posts })).toBeNull();
  });

  it('leaves one agent talking to itself alone', () => {
    expect(loopPair({ lines: 12, posts: run(Array.from({ length: 12 }, () => 'api')) })).toBeNull();
  });
});

describe('nextPresence', () => {
  it.each([
    ['active', 1, 'active'],
    ['active', 2, 'idle'],
    ['waiting', 10, 'waiting'],
    ['idle', 29, 'idle'],
    ['idle', 30, 'away'],
    ['waiting', 30, 'away'],
    ['away', 1, 'away'],
  ] as const)('moves %s after %i minutes to %s', (presence, after, expected) => {
    expect(nextPresence({ member: member({ name: 'api', presence }), now: minutes(after) })).toBe(expected);
  });
});

describe('canAssignRole', () => {
  it.each([
    ['human', 'human', 'unassigned', true],
    ['orchestrator', 'claude', 'orchestrator', true],
    ['boss', 'codex', 'orchestrator', true],
    ['orchestrator', 'claude', 'worker', false],
    ['api', 'claude', 'reviewer', false],
    ['api', 'claude', 'unassigned', false],
  ] as const)('%s (%s, %s) may assign: %s', (name, kind, role, allowed) => {
    expect(canAssignRole({ by: member({ kind, name, role }) })).toBe(allowed);
  });
});
