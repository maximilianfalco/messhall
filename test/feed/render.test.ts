import type { BusEvent } from '../../contracts/events.ts';
import type { Snapshot } from '../../contracts/feed.ts';
import type { Agreement, Approval, Member, Message, Question, Room } from '../../contracts/room.ts';

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
  muted: false,
  name: 'api',
  presence: 'active',
  role: 'unassigned',
  room_id: 'room-1',
  status: null,
  status_at: null,
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

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  answered_at: null,
  created_at: AT,
  description: 'Run the tests',
  id: '4b0c6a52-0d7e-4b8e-9c55-0f6a1e2b3c4d',
  input_preview: '{"command": "pnpm test"}',
  member: 'api',
  room: 'checkout',
  state: 'pending',
  tool: 'Bash',
  ...overrides,
});

const QUESTION_ID = '9d2f1c3e-5a4b-4c6d-8e7f-0a1b2c3d4e5f';

const question = (overrides: Partial<Question> = {}): Question => ({
  answer: null,
  answered_at: null,
  created_at: AT,
  id: QUESTION_ID,
  member: 'api',
  message_id: 12,
  options: ['ship it', 'wait'],
  question: 'merge now?',
  room: 'checkout',
  state: 'open',
  ...overrides,
});

const agreement = (overrides: Partial<Agreement> = {}): Agreement => ({
  confirmed: [],
  created_at: AT,
  decided_at: null,
  id: 14,
  proposer: 'api',
  rejected_by: null,
  replaces: null,
  room: 'checkout',
  state: 'open',
  text: 'amount_minor is integer cents',
  why: null,
  with: ['web', 'mobile'],
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
    ['removed', member({ left_at: AT, presence: 'left' }), '       - api dropped out'],
    ['role', member({ name: 'reviewer-1', role: 'reviewer' }), '       * reviewer-1 is now reviewer'],
    ['status', member({ status: 'tests green' }), '       · api status: tests green'],
    ['status', member(), '       · api status cleared'],
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

describe('renderEvent approvals', () => {
  it('shows a pending ask with the tool and what it runs', () => {
    expect(render({ approval: approval(), room: 'checkout', type: 'approval' })).toStrictEqual([
      '       #checkout  ? api asks to use Bash: Run the tests {"command": "pnpm test"}',
    ]);
  });

  it.each([
    ['allowed', 'allowed'],
    ['denied', 'denied'],
    ['expired', 'expired, denied'],
  ] as const)('shows an %s ask as %s', (state, word) => {
    expect(render({ approval: approval({ state }), room: 'checkout', type: 'approval' }, 'checkout')).toStrictEqual([
      `       · api Bash ${word}`,
    ]);
  });
});

describe('renderEvent questions', () => {
  it('shows an open question with the command that answers it', () => {
    expect(render({ question: question(), room: 'checkout', type: 'question' })).toStrictEqual([
      `       #checkout  ? api asks you #12, pick with: messhall answer ${QUESTION_ID} <1-2>`,
    ]);
  });

  it.each([
    [{ answer: 1, state: 'answered' }, 'answered: wait'],
    [{ state: 'expired' }, 'expired with no answer'],
    [{ state: 'replaced' }, 'replaced by a newer one'],
  ] as const)('shows a closed question %j', (overrides, words) => {
    expect(render({ question: question(overrides), room: 'checkout', type: 'question' }, 'checkout')).toStrictEqual([
      `       · api question #12 ${words}`,
    ]);
  });
});

describe('renderEvent agreements', () => {
  it.each([
    [{}, 'proposed by api, waiting on web and mobile'],
    [{ confirmed: ['web'] }, 'confirmed by web, waiting on mobile'],
    [{ confirmed: ['web', 'mobile'], state: 'settled' }, 'settled'],
    [{ rejected_by: 'web', state: 'rejected', why: 'no' }, 'rejected by web'],
    [{ state: 'replaced' }, 'replaced by a newer one'],
  ] satisfies [Partial<Agreement>, string][])('shows an agreement %j', (overrides, words) => {
    expect(render({ agreement: agreement(overrides), room: 'checkout', type: 'agreement' }, 'checkout')).toStrictEqual([
      `       · agreement #14 ${words}`,
    ]);
  });
});

const snapshot: Snapshot = {
  build: null,
  contract_version: 5,
  rooms: [
    {
      ...room({ topic: 'ship the cart' }),
      agreements: [agreement({ confirmed: ['web', 'mobile'], state: 'settled' })],
      approvals: [],
      members: [
        member(),
        member({ kind: 'codex', name: 'web', presence: 'waiting' }),
        member({ kind: 'human', name: 'human', presence: 'idle' }),
        member({ kind: 'other', left_at: AT, name: 'ci', presence: 'left' }),
      ],
      first_message_id: 1,
      message_count: 2,
      messages: [message(), message({ from: 'human', id: 2, text: 'nice' })],
      questions: [question()],
    },
    {
      ...room({ closed_at: AT, created_by: 'human', id: 'room-2', name: 'search', standing: true }),
      agreements: [],
      approvals: [],
      first_message_id: null,
      members: [],
      message_count: 0,
      messages: [],
      questions: [],
    },
  ],
  seq: 9,
  version: '0.1.0',
};

describe('renderSnapshot', () => {
  it('prints every room with the members still in it and last messages', () => {
    expect(plain(renderSnapshot({ snapshot }))).toStrictEqual([
      '#checkout  open, 2 posts, ship the cart',
      '       api active, web waiting, human',
      '10:04  api  hello',
      '10:04  human  nice',
      `       ? api asks you #12: merge now? 1. ship it  2. wait. messhall answer ${QUESTION_ID} <1-2>`,
      '       = agreement #14 settled, api with web and mobile: amount_minor is integer cents',
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
    expect(
      plain(renderSnapshot({ snapshot: { build: null, contract_version: 1, rooms: [], seq: 0, version: '0.1.0' } })),
    ).toStrictEqual(['no rooms yet']);
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
