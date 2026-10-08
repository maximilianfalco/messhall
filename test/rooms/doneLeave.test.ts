import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'web', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'orchestrator', kind: 'claude', room: 'demo' });
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;
const minutes = (count: number) => count * 60_000;
const presenceOf = (name: string) =>
  store()
    .listMembers('demo', { left: true })
    .find(member => member.name === name)?.presence;
const lastLine = () => {
  const page = store().listMessages({ limit: 50, room: 'demo' });
  return page.ok ? page.messages.at(-1)?.text : undefined;
};

function goAwayAfter(silentMinutes: number) {
  scratch.clock.advance(minutes(silentMinutes));
  store().sweepPresence({ ringable: () => false });
}

describe('leaveDoneAway', () => {
  it('keeps a done seat away for 59 minutes and lets it go at 61', () => {
    store().postMessage({ done: true, from: 'api', room: 'demo', text: 'shipped' });

    goAwayAfter(59);
    expect(store().leaveDoneAway()).toStrictEqual([]);
    expect(presenceOf('api')).toBe('away');

    scratch.clock.advance(minutes(2));
    expect(store().leaveDoneAway()).toStrictEqual([{ name: 'api', room: 'demo' }]);
    expect(presenceOf('api')).toBe('left');
    expect(lastLine()).toBe('api left, done and away for 60 minutes');
  });

  it('keeps an away seat that is not done', () => {
    goAwayAfter(61);

    expect(store().leaveDoneAway()).toStrictEqual([]);
    expect(presenceOf('web')).toBe('away');
  });

  it('keeps a done orchestrator however long it is away', () => {
    store().postMessage({ done: true, from: 'orchestrator', room: 'demo', text: 'all routed' });

    goAwayAfter(120);

    expect(store().leaveDoneAway()).toStrictEqual([]);
    expect(presenceOf('orchestrator')).toBe('away');
  });

  it('keeps a done seat that is still here', () => {
    store().postMessage({ done: true, from: 'api', room: 'demo', text: 'shipped' });

    scratch.clock.advance(minutes(61));
    store().sweepPresence({ ringable: () => true });

    expect(store().leaveDoneAway()).toStrictEqual([]);
    expect(presenceOf('api')).toBe('idle');
  });

  it('emits a left member event so the spawner can stop the seat', () => {
    store().postMessage({ done: true, from: 'api', room: 'demo', text: 'shipped' });
    goAwayAfter(61);
    const changes: string[] = [];
    store().events.on(({ event }) => {
      if (event.type === 'member') changes.push(`${event.member.name} ${event.change}`);
    });

    store().leaveDoneAway();

    expect(changes).toStrictEqual(['api left']);
  });
});
