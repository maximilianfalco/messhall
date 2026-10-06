import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
});

afterEach(() => {
  scratch.cleanup();
});

const DAY = 24 * 60 * 60_000;
const summary = (events: SequencedEvent[]) =>
  events.map(({ event }) => (event.type === 'message' ? `message ${event.message.text}` : `${event.type}`));

describe('the event bus', () => {
  it('emits each change with a rising global sequence', () => {
    const seen: SequencedEvent[] = [];
    scratch.store.events.on(event => seen.push(event));

    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(summary(seen)).toStrictEqual(['room', 'member', 'member', 'message api joined']);
    expect(seen.map(event => event.seq)).toStrictEqual([1, 2, 3, 4]);
    expect(seen[2]!.event).toMatchObject({ change: 'joined', member: { name: 'api' }, room: 'demo' });
  });

  it('replays the events after a sequence, from disk', () => {
    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    scratch.store.postMessage({ from: 'api', room: 'demo', text: 'hi' });
    scratch.reopen();

    expect(summary(scratch.store.events.since(3))).toStrictEqual(['message api joined', 'message hi']);
  });

  it('stops calling a listener once it is removed', () => {
    const seen: SequencedEvent[] = [];
    const off = scratch.store.events.on(event => seen.push(event));
    off();

    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect(seen).toStrictEqual([]);
  });

  it('drops events older than 7 days', () => {
    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    scratch.clock.advance(8 * DAY);

    scratch.store.postMessage({ from: 'api', room: 'demo', text: 'later' });

    expect(summary(scratch.store.events.since(0))).toStrictEqual(['message later']);
  });
});
