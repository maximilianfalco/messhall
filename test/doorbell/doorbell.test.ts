import type { RingInput, Ringer } from '../../src/doorbell/ringer.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startDoorbell } from '../../src/doorbell/doorbell.js';
import { createRingers } from '../../src/doorbell/ringer.js';
import { scratchStore } from '../rooms/scratch.js';

type Scratch = ReturnType<typeof scratchStore>;

function setup(scratch: Scratch) {
  const rung: RingInput[] = [];
  const ringer: Ringer = {
    kinds: ['claude'],
    ring: input => {
      rung.push(input);
      return Promise.resolve(1);
    },
  };
  let timers: { fire: () => void; when: number }[] = [];
  const setTimer = (fire: () => void, ms: number) => {
    const timer = { fire, when: scratch.clock.now().getTime() + ms };
    timers.push(timer);
    return () => {
      timers = timers.filter(item => item !== timer);
    };
  };
  const advance = async (ms: number) => {
    scratch.clock.advance(ms);
    const at = scratch.clock.now().getTime();
    const due = timers.filter(timer => timer.when <= at);
    timers = timers.filter(timer => timer.when > at);
    due.forEach(timer => timer.fire());
    await Promise.resolve();
  };
  const doorbell = startDoorbell({
    now: scratch.clock.now,
    ringers: createRingers([ringer]),
    setTimer,
    store: scratch.store,
  });
  return { advance, doorbell, rung, stop: doorbell.stop };
}

describe('createRingers', () => {
  it('finds a ringer under each kind it serves', () => {
    const ring = () => Promise.resolve(0);
    const channel: Ringer = { kinds: ['claude', 'other'], ring };
    const codex: Ringer = { kinds: ['codex'], ring };
    const ringers = createRingers([channel, codex]);
    expect(ringers.for('claude')).toBe(channel);
    expect(ringers.for('other')).toBe(channel);
    expect(ringers.for('codex')).toBe(codex);
    expect(ringers.for('human')).toBeUndefined();
  });
});

describe('startDoorbell', () => {
  let scratch: Scratch;

  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    scratch = scratchStore();
    scratch.store.joinRoom({ as: 'api', kind: 'other', room: 'checkout' });
    scratch.store.joinRoom({ as: 'web', kind: 'claude', room: 'checkout' });
    scratch.store.joinRoom({ as: 'infra', kind: 'claude', room: 'checkout' });
    scratch.clock.advance(10_000);
  });

  afterEach(() => {
    scratch.cleanup();
    vi.restoreAllMocks();
  });

  it('rings a claude member mentioned in a post through its ringer', async () => {
    const { advance, rung, stop } = setup(scratch);
    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web the schema moved' });
    await advance(3000);
    expect(rung).toStrictEqual([
      {
        member: { name: 'web', rooms: ['checkout'] },
        meta: { count: '1', room: 'checkout' },
        text: 'messhall: 1 new in #checkout, api mentioned you. Call read_since.',
      },
    ]);
    stop();
  });

  it('stops ringing a paused pair until the human posts', async () => {
    Array.from({ length: 12 }, (_, index) =>
      scratch.store.postMessage({
        from: index % 2 ? 'web' : 'api',
        room: 'checkout',
        text: `@${index % 2 ? 'api' : 'web'} hi`,
      }),
    );
    const { advance, rung, stop } = setup(scratch);

    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web still there?' });
    await advance(3000);
    expect(rung).toStrictEqual([]);

    scratch.store.postMessage({ from: 'human', room: 'checkout', text: 'wrap up' });
    await advance(3000);
    expect(rung.map(ring => ring.member.name)).toStrictEqual(['infra', 'web']);
    stop();
  });

  it('rings a paused partner for the lines it missed once the pause ends', async () => {
    Array.from({ length: 12 }, (_, index) =>
      scratch.store.postMessage({ from: index % 2 ? 'web' : 'api', room: 'checkout', text: 'hi' }),
    );
    const { advance, doorbell, rung, stop } = setup(scratch);
    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web your turn' });
    await advance(3000);
    expect(rung).toStrictEqual([]);

    await advance(5 * 60_000);
    doorbell.endPauses();
    await advance(3000);
    expect(rung.map(ring => [ring.member.name, ring.text])).toStrictEqual([
      ['web', 'messhall: 1 new in #checkout, api mentioned you. Call read_since.'],
    ]);
    stop();
  });

  it('rings nobody for a kind with no ringer', async () => {
    const { advance, rung, stop } = setup(scratch);
    scratch.store.postMessage({ from: 'web', room: 'checkout', text: '@api ping' });
    await advance(3000);
    expect(rung).toStrictEqual([]);
    stop();
  });

  it('rings nobody for system lines like a join', async () => {
    const { advance, rung, stop } = setup(scratch);
    scratch.store.joinRoom({ as: 'ops', kind: 'claude', room: 'checkout' });
    await advance(3000);
    expect(rung).toStrictEqual([]);
    stop();
  });

  it('delays the ring for a member active in the last 5 s until the grace passes', async () => {
    const { advance, rung, stop } = setup(scratch);
    scratch.store.touch({ as: 'web', room: 'checkout', state: 'active' });
    await advance(1000);
    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web the schema moved' });
    await advance(3000);
    expect(rung).toStrictEqual([]);
    await advance(2999);
    expect(rung).toStrictEqual([]);
    await advance(1);
    expect(rung.map(ring => ring.text)).toStrictEqual([
      'messhall: 1 new in #checkout, api mentioned you. Call read_since.',
    ]);
    stop();
  });

  it('drops the delayed ring when the member reads in between', async () => {
    const { advance, rung, stop } = setup(scratch);
    scratch.store.touch({ as: 'web', room: 'checkout', state: 'active' });
    await advance(1000);
    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web the schema moved' });
    await advance(2000);
    scratch.store.readUnseen({ as: 'web', room: 'checkout' });
    await advance(30_000);
    expect(rung).toStrictEqual([]);
    stop();
  });

  it('stops ringing once stopped', async () => {
    const { advance, rung, stop } = setup(scratch);
    stop();
    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web the schema moved' });
    await advance(3000);
    expect(rung).toStrictEqual([]);
  });
});
