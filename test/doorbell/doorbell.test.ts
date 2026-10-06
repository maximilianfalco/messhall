import type { RingInput, Ringer } from '../../src/doorbell/ringers.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startDoorbell } from '../../src/doorbell/doorbell.js';
import { createRingers } from '../../src/doorbell/ringers.js';
import { scratchStore } from '../rooms/scratch.js';

type Scratch = ReturnType<typeof scratchStore>;

function setup(scratch: Scratch) {
  const rung: RingInput[] = [];
  const ringer: Ringer = {
    kind: 'claude',
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
  const stop = startDoorbell({
    now: scratch.clock.now,
    ringers: createRingers([ringer]),
    setTimer,
    store: scratch.store,
  });
  return { advance, rung, stop };
}

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

  it('stops ringing once stopped', async () => {
    const { advance, rung, stop } = setup(scratch);
    stop();
    scratch.store.postMessage({ from: 'api', room: 'checkout', text: '@web the schema moved' });
    await advance(3000);
    expect(rung).toStrictEqual([]);
  });
});
