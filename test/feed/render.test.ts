import type { BusEvent } from '../../contracts/events.ts';
import type { Snapshot } from '../../contracts/feed.ts';
import type { Member, Message, Room } from '../../contracts/room.ts';

import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderEvent, renderRooms, renderSnapshot } from '../../src/feed/render.js';

const AT = '2026-01-01T10:04:00.000Z';

const room = (overrides: Partial<Room> = {}): Room => ({
  closed_at: null,
  created_at: AT,
  created_by: 'api',
  id: 'room-1',
  name: 'checkout',
  standing: false,
  topic: null,
  ...overrides,
});

const member = (overrides: Partial<Member> = {}): Member => ({
  client_label: null,
  client_name: null,
  client_version: null,
  cursor: 0,
  done: false,
  joined_at: AT,
  kind: 'claude',
  last_seen_at: AT,
  left_at: null,
  name: 'api',
  presence: 'active',
  role: 'unassigned',
  room_id: 'room-1',
  ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  created_at: AT,
  from: 'api',
  from_client_label: null,
  from_kind: null,
  id: 1,
  kind: 'chat',
  mentions: [],
  room_id: 'room-1',
  text: 'hello',
  ...overrides,
});

const plain = (lines: string[]) => lines.map(line => stripVTControlCharacters(line));
const render = (event: BusEvent, filter?: string) => plain(renderEvent({ event, room: filter }));

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('renderEvent', () => {
  it.each([
    [
      'a chat line with its mentions',
      message({ mentions: ['web'], text: '@web schema is ready' }),
      '10:04  api → @web  @web schema is ready',
    ],
    ['a human line', message({ from: 'human', text: 'api, bump the version' }), '10:04  human  api, bump the version'],
    ['a system line', message({ from: 'messhall', kind: 'system', text: 'web joined' }), '10:04  web joined'],
    ['a done line with a check', message({ kind: 'done', text: 'shipped' }), '10:04  api  ✓ shipped'],
  ])('renders %s', (_, posted, line) => {
    expect(render({ message: posted, room: 'checkout', type: 'message' }, 'checkout')).toStrictEqual([line]);
  });

  it.each([
    ['joined', member({ kind: 'codex', name: 'web' }), '       + web joined (codex)'],
    ['left', member({ left_at: AT }), '       - api left'],
    ['reconnected', member(), '       + api reconnected (claude)'],
    ['role', member({ name: 'reviewer-1', role: 'reviewer' }), '       * reviewer-1 is now reviewer'],
  ] as const)('renders a member who %s', (change, who, line) => {
    expect(render({ change, member: who, room: 'checkout', type: 'member' }, 'checkout')).toStrictEqual([line]);
  });

  it('renders a presence change', () => {
    expect(
      render({ from: 'active', name: 'api', room: 'checkout', to: 'waiting', type: 'presence' }, 'checkout'),
    ).toStrictEqual(['       · api active → waiting']);
  });

  it.each([
    ['created', room(), '       · #checkout created'],
    ['closed', room({ closed_at: AT }), '       · #checkout closed'],
    ['reopened', room(), '       · #checkout reopened'],
    ['topic', room({ topic: 'ship the cart' }), '       · #checkout topic: ship the cart'],
  ] as const)('renders a room that was %s', (change, changed, line) => {
    expect(render({ change, room: changed, type: 'room' }, 'checkout')).toStrictEqual([line]);
  });

  it('tags each line with its room when watching every room', () => {
    expect(render({ message: message(), room: 'checkout', type: 'message' })).toStrictEqual([
      '10:04  #checkout  api  hello',
    ]);
    expect(render({ from: 'idle', name: 'api', room: 'checkout', to: 'active', type: 'presence' })).toStrictEqual([
      '       #checkout  · api idle → active',
    ]);
  });

  it('drops events from other rooms', () => {
    expect(render({ message: message(), room: 'search', type: 'message' }, 'checkout')).toStrictEqual([]);
    expect(render({ change: 'closed', room: room({ name: 'search' }), type: 'room' }, 'checkout')).toStrictEqual([]);
  });
});

const snapshot: Snapshot = {
  rooms: [
    {
      ...room({ topic: 'ship the cart' }),
      members: [
        member(),
        member({ kind: 'codex', name: 'web', presence: 'waiting' }),
        member({ kind: 'human', name: 'human', presence: 'idle' }),
        member({ kind: 'other', left_at: AT, name: 'ci', presence: 'left' }),
      ],
      first_message_id: 1,
      message_count: 2,
      messages: [message(), message({ from: 'human', id: 2, text: 'nice' })],
    },
    {
      ...room({ closed_at: AT, created_by: 'human', id: 'room-2', name: 'search', standing: true }),
      first_message_id: null,
      members: [],
      message_count: 0,
      messages: [],
    },
  ],
  seq: 9,
};

describe('renderSnapshot', () => {
  it('prints every room with the members still in it and last messages', () => {
    expect(plain(renderSnapshot({ snapshot }))).toStrictEqual([
      '#checkout  open, 2 posts, ship the cart',
      '       api active, web waiting, human',
      '10:04  api  hello',
      '10:04  human  nice',
      '',
      '#search  closed, standing, 0 posts',
      '       nobody here',
    ]);
  });

  it('prints only the watched room', () => {
    expect(plain(renderSnapshot({ room: 'search', snapshot }))).toStrictEqual([
      '#search  closed, standing, 0 posts',
      '       nobody here',
    ]);
  });

  it('says when the watched room does not exist yet', () => {
    expect(plain(renderSnapshot({ room: 'nope', snapshot }))).toStrictEqual([
      'no room #nope yet, it shows up when an agent joins',
    ]);
  });

  it('says when there are no rooms', () => {
    expect(plain(renderSnapshot({ snapshot: { rooms: [], seq: 0 } }))).toStrictEqual(['no rooms yet']);
  });
});

describe('renderRooms', () => {
  it('lists each room in one line, counting only members still in it', () => {
    expect(plain(renderRooms({ snapshot }))).toStrictEqual([
      '#checkout  open, 3 members, 2 posts, ship the cart',
      '#search  closed, standing, 0 members, 0 posts',
    ]);
  });
});
