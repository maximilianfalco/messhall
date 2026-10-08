import type { Member, Message } from '../../contracts/room.ts';
import type { RingBatch } from '../../src/doorbell/batch.js';

import { describe, expect, it } from 'vitest';

import { createBatcher } from '../../src/doorbell/batch.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');

const member = (name: string): Member => ({
  client_label: null,
  client_name: null,
  client_version: null,
  cursor: 0,
  done: false,
  joined_at: new Date(T0).toISOString(),
  kind: 'claude',
  last_seen_at: new Date(T0).toISOString(),
  left_at: null,
  muted: false,
  presence: 'idle',
  role: 'unassigned',
  room_id: 'r1',
  status: null,
  status_at: null,
  name,
});

const MEMBERS = [member('api'), member('web'), member('infra')];

function fakeTimers() {
  let at = T0 + 60_000;
  let timers: { fire: () => void; when: number }[] = [];
  return {
    advance(ms: number) {
      at += ms;
      const due = timers.filter(timer => timer.when <= at);
      timers = timers.filter(timer => timer.when > at);
      due.forEach(timer => timer.fire());
    },
    now: () => new Date(at),
    pending: () => timers.length,
    setTimer(fire: () => void, ms: number) {
      const timer = { fire, when: at + ms };
      timers.push(timer);
      return () => {
        timers = timers.filter(item => item !== timer);
      };
    },
  };
}

function setup() {
  const timers = fakeTimers();
  const rings: RingBatch[] = [];
  const batcher = createBatcher({
    deliver: batch => {
      rings.push(batch);
    },
    members: () => MEMBERS,
    now: timers.now,
    setTimer: timers.setTimer,
  });
  let id = 0;
  const post = (room: string, text = '@web look') => {
    id += 1;
    const message: Message = {
      created_at: timers.now().toISOString(),
      edited_at: null,
      from: 'api',
      from_client_label: null,
      from_kind: null,
      id,
      kind: 'chat',
      mentions: text.includes('@web') ? ['web'] : [],
      removed_at: null,
      room_id: room,
      text,
    };
    batcher.add({ closed: false, message, pausedWith: {}, room });
  };
  return { batcher, post, rings, timers };
}

describe('createBatcher', () => {
  it('fires one ring 3 s after the first of three quick messages', () => {
    const { post, rings, timers } = setup();
    post('checkout');
    timers.advance(1000);
    post('checkout');
    timers.advance(1000);
    post('checkout');
    timers.advance(999);
    expect(rings).toStrictEqual([]);
    timers.advance(1);
    expect(rings).toStrictEqual([
      {
        kind: 'claude',
        meta: { count: '3', room: 'checkout' },
        name: 'web',
        rooms: ['checkout'],
        text: 'messhall: 3 new in #checkout, api mentioned you. Call read_since.',
      },
    ]);
  });

  it('holds the second burst until 20 s after the first ring', () => {
    const { post, rings, timers } = setup();
    post('checkout');
    timers.advance(3000);
    timers.advance(2000);
    post('checkout');
    post('checkout');
    timers.advance(17_999);
    expect(rings).toHaveLength(1);
    timers.advance(1);
    expect(rings.map(ring => ring.text)).toStrictEqual([
      'messhall: 1 new in #checkout, api mentioned you. Call read_since.',
      'messhall: 2 new in #checkout, api mentioned you. Call read_since.',
    ]);
  });

  it('folds two rooms into one line', () => {
    const { post, rings, timers } = setup();
    post('checkout');
    post('checkout');
    post('auth');
    timers.advance(3000);
    expect(rings).toStrictEqual([
      {
        kind: 'claude',
        meta: { count: '3', room: 'checkout,auth' },
        name: 'web',
        rooms: ['checkout', 'auth'],
        text: 'messhall: 2 new in #checkout, 1 in #auth. Call read_since.',
      },
    ]);
  });

  it('queues nothing for a message that rings nobody', () => {
    const { post, timers } = setup();
    post('checkout', 'no mention here');
    expect(timers.pending()).toBe(0);
  });

  it('drops pending rings on stop', () => {
    const { batcher, post, rings, timers } = setup();
    post('checkout');
    batcher.stop();
    timers.advance(3000);
    expect(rings).toStrictEqual([]);
    expect(timers.pending()).toBe(0);
  });
});
