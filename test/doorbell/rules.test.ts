import type { Member, Message } from '../../contracts/room.ts';

import { describe, expect, it } from 'vitest';

import { activeLately, ringsFor, ringText } from '../../src/doorbell/rules.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

const member = (fields: Partial<Member> & Pick<Member, 'name'>): Member => ({
  client_label: null,
  client_name: null,
  client_version: null,
  cursor: 0,
  done: false,
  joined_at: at(0),
  kind: 'claude',
  last_seen_at: at(0),
  left_at: null,
  muted: false,
  presence: 'idle',
  role: 'unassigned',
  room_id: 'r1',
  ...fields,
});

const message = (fields: Partial<Message> & Pick<Message, 'from'>): Message => ({
  created_at: at(60_000),
  from_client_label: null,
  from_kind: null,
  id: 7,
  kind: 'chat',
  mentions: [],
  room_id: 'r1',
  text: 'hi',
  ...fields,
});

const NOW = new Date(T0 + 60_000);
const THREE = [
  member({ kind: 'human', name: 'human' }),
  member({ name: 'api' }),
  member({ name: 'web' }),
  member({ kind: 'codex', name: 'infra' }),
];
const rung = (input: Partial<Parameters<typeof ringsFor>[0]> & Pick<Parameters<typeof ringsFor>[0], 'message'>) =>
  ringsFor({ closed: false, lastRing: {}, members: THREE, now: NOW, pausedWith: {}, ...input }).map(ring => ring.name);

describe('ringsFor', () => {
  it('rings a mentioned member 3 s from now and names who mentioned it', () => {
    expect(
      ringsFor({
        closed: false,
        lastRing: {},
        members: THREE,
        message: message({ from: 'api', mentions: ['web'] }),
        now: NOW,
        pausedWith: {},
      }),
    ).toStrictEqual([{ at: T0 + 63_000, kind: 'claude', mentionedBy: 'api', name: 'web' }]);
  });

  it('rings every agent but the poster on @all', () => {
    expect(rung({ message: message({ from: 'api', mentions: ['all'] }) })).toStrictEqual(['web', 'infra']);
  });

  it('rings the other agent in a room of two agents', () => {
    const two = [member({ kind: 'human', name: 'human' }), member({ name: 'api' }), member({ name: 'web' })];
    expect(rung({ members: two, message: message({ from: 'api' }) })).toStrictEqual(['web']);
  });

  it('rings nobody for an unmentioned line in a room of three agents', () => {
    expect(rung({ message: message({ from: 'api' }) })).toStrictEqual([]);
  });

  it('never rings the poster', () => {
    expect(rung({ message: message({ from: 'web', mentions: ['web', 'api'] }) })).toStrictEqual(['api']);
  });

  it('never rings for a system line', () => {
    expect(rung({ message: message({ from: 'messhall', kind: 'system', mentions: ['all'] }) })).toStrictEqual([]);
  });

  it('rings only the live orchestrator for an unmentioned human line', () => {
    const members = [...THREE, member({ name: 'lead', role: 'orchestrator' })];
    expect(rung({ members, message: message({ from: 'human' }) })).toStrictEqual(['lead']);
  });

  it('rings every agent for an unmentioned human line when the orchestrator is away', () => {
    const members = [...THREE, member({ name: 'lead', presence: 'away', role: 'orchestrator' })];
    expect(rung({ members, message: message({ from: 'human' }) })).toStrictEqual(['api', 'web', 'infra', 'lead']);
  });

  it('never rings the human', () => {
    expect(rung({ message: message({ from: 'api', mentions: ['human', 'web'] }) })).toStrictEqual(['web']);
  });

  it('still rings a member active in the last 5 s, the batcher holds it', () => {
    const members = [member({ name: 'api' }), member({ last_seen_at: at(56_000), name: 'web', presence: 'active' })];
    expect(rung({ members, message: message({ from: 'api', mentions: ['web'] }) })).toStrictEqual(['web']);
  });

  it('skips a member blocked in wait', () => {
    const members = [member({ name: 'api' }), member({ name: 'web', presence: 'waiting' })];
    expect(rung({ members, message: message({ from: 'api', mentions: ['web'] }) })).toStrictEqual([]);
  });

  it('still rings an idle or away member', () => {
    const members = [member({ name: 'api' }), member({ name: 'web', presence: 'away' })];
    expect(rung({ members, message: message({ from: 'api', mentions: ['web'] }) })).toStrictEqual(['web']);
  });

  it('never rings for a line between a paused pair, but still for a third agent', () => {
    const pausedWith = { api: 'web', web: 'api' };
    expect(rung({ message: message({ from: 'api', mentions: ['web'] }), pausedWith })).toStrictEqual([]);
    expect(rung({ message: message({ from: 'infra', mentions: ['web'] }), pausedWith })).toStrictEqual(['web']);
  });

  it('never rings in a closed room', () => {
    expect(rung({ closed: true, message: message({ from: 'api', mentions: ['web'] }) })).toStrictEqual([]);
  });

  it('holds a member rung less than 20 s ago until 20 s after that ring', () => {
    const [ring] = ringsFor({
      closed: false,
      lastRing: { web: T0 + 50_000 },
      members: THREE,
      message: message({ from: 'api', mentions: ['web'] }),
      now: NOW,
      pausedWith: {},
    });
    expect(ring?.at).toBe(T0 + 70_000);
  });

  it('leaves mentionedBy out when the member was not named', () => {
    const [ring] = ringsFor({
      closed: false,
      lastRing: {},
      members: THREE,
      message: message({ from: 'human' }),
      now: NOW,
      pausedWith: {},
    });
    expect(ring).toStrictEqual({ at: T0 + 63_000, kind: 'claude', name: 'api' });
  });
});

describe('ringText', () => {
  it.each([
    [
      [{ count: 3, mentionedBy: 'web', room: 'checkout' }],
      'messhall: 3 new in #checkout, web mentioned you. Call read_since.',
    ],
    [[{ count: 1, room: 'checkout' }], 'messhall: 1 new in #checkout. Call read_since.'],
    [
      [
        { count: 2, mentionedBy: 'web', room: 'checkout' },
        { count: 1, room: 'auth' },
      ],
      'messhall: 2 new in #checkout, 1 in #auth. Call read_since.',
    ],
  ])('writes %j as one line', (rooms, expected) => {
    expect(ringText({ rooms })).toBe(expected);
  });
});

describe('activeLately', () => {
  it.each([
    ['active 4 s ago', member({ last_seen_at: at(56_000), name: 'web', presence: 'active' }), true],
    ['active 5 s ago', member({ last_seen_at: at(55_000), name: 'web', presence: 'active' }), false],
    ['idle', member({ last_seen_at: at(59_000), name: 'web' }), false],
  ])('%s', (_label, seat, expected) => {
    expect(activeLately({ member: seat, now: NOW })).toBe(expected);
  });
});
