import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReachOf } from '../../src/feed/reach.js';
import { buildSnapshot } from '../../src/feed/snapshot.js';
import { scratchStore } from '../rooms/scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.ensureHuman('demo');
  scratch.store.joinRoom({ as: 'plain', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'bell', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'thread', kind: 'codex', room: 'demo' });
  scratch.store.joinRoom({ as: 'pending', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'opencode', kind: 'other', room: 'demo' });
  ['spawn', 'spawnoff'].forEach(name =>
    scratch.store.invite({ by: 'human', launch: { agent: 'claude', cwd: '/tmp' }, name, role: 'worker', room: 'demo' }),
  );
});

afterEach(() => {
  scratch.cleanup();
});

const entries = (doorbell: 'checking' | 'off' | 'on' | 'unchecked', ringable: boolean) => [
  { session: { doorbell, ringable } },
];
const sessionsFor = ({ name }: { name: string }) => {
  if (name === 'spawn') return entries('on', true);
  if (name === 'spawnoff') return entries('off', true);
  if (name === 'plain') return entries('off', true);
  if (name === 'bell') return entries('on', true);
  if (name === 'thread') return entries('unchecked', true);
  if (name === 'pending') return entries('checking', true);
  if (name === 'opencode') return entries('unchecked', false);
  return [];
};
const reachOf = () => createReachOf({ sessionsFor, store: scratch.store });
const reach = (name: string) => reachOf()({ name, room: 'demo' });

describe('reachOf', () => {
  it('says spawned for a seat messhall started, whatever its doorbell says', () => {
    expect(reach('spawn')).toBe('spawned');
    expect(reach('spawnoff')).toBe('spawned');
  });

  it('says doorbell for a session the ring reaches', () => {
    expect(reach('bell')).toBe('doorbell');
  });

  it('says no_doorbell for a claude whose test ring got no answer', () => {
    expect(reach('plain')).toBe('no_doorbell');
  });

  it('reads a codex seat with a thread as doorbell', () => {
    expect(reach('thread')).toBe('doorbell');
  });

  it('reads doorbell while the test ring is still out', () => {
    expect(reach('pending')).toBe('doorbell');
  });

  it('says no_doorbell for a client that takes no channel', () => {
    expect(reach('opencode')).toBe('no_doorbell');
  });

  it('has none for the human seat', () => {
    expect(reach('human')).toBeUndefined();
  });

  it('puts reach on every snapshot member', () => {
    const members = buildSnapshot({
      build: null,
      reachOf: reachOf(),
      store: scratch.store,
    }).rooms[0]!.members;

    expect(Object.fromEntries(members.map(item => [item.name, item.reach]))).toStrictEqual({
      bell: 'doorbell',
      human: undefined,
      opencode: 'no_doorbell',
      pending: 'doorbell',
      plain: 'no_doorbell',
      spawn: 'spawned',
      spawnoff: 'spawned',
      thread: 'doorbell',
    });
  });
});
