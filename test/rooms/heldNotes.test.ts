import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore } from './scratch.js';

const HOUR = 60 * 60_000;

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
  scratch.store.joinRoom({ as: 'web', kind: 'claude', room: 'demo' });
});

afterEach(() => {
  scratch.cleanup();
});

const say = (from: string, text: string) => scratch.store.postMessage({ from, room: 'demo', text });

const join = (as: string) => scratch.store.joinRoom({ as, kind: 'claude', room: 'demo' });

describe('held notes', () => {
  it('tells a name that joins how many notes wait and from whom', () => {
    say('api', '@worker-1 the schema is in src/order.ts');
    say('web', '@worker-1 and @worker-2 ping');

    const joined = join('worker-1');

    expect(joined.ok && joined.notes).toStrictEqual({ count: 2, from: ['api', 'web'] });
  });

  it('shows the notes on the first read even when a summary covers them', () => {
    const note = say('api', '@worker-1 read this first');
    say('web', 'later chatter');
    join('worker-1');

    const read = scratch.store.readUnseen({ as: 'worker-1', room: 'demo' });

    expect(read.ok && read.messages.map(message => message.id)).toContain(note.ok ? note.message.id : -1);
  });

  it('hands a note over once', () => {
    say('api', '@worker-1 once');
    join('worker-1');
    scratch.store.leaveRoom({ as: 'worker-1', room: 'demo' });

    const again = join('worker-1');

    expect(again.ok && again.notes).toStrictEqual({ count: 0, from: [] });
  });

  it('drops a note older than a day', () => {
    say('api', '@worker-1 stale');
    scratch.clock.advance(25 * HOUR);

    const joined = join('worker-1');

    expect(joined.ok && joined.notes.count).toBe(0);
  });

  it('keeps a note for a name that is not the one joining', () => {
    say('api', '@worker-2 for you');

    const other = join('worker-1');
    const target = join('worker-2');

    expect(other.ok && other.notes.count).toBe(0);
    expect(target.ok && target.notes.count).toBe(1);
  });
});
