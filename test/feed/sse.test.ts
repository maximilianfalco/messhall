import type { Sink } from '../../src/feed/sse.js';
import type { Frame } from './feedServer.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotSchema } from '../../contracts/feed.ts';
import { FEED_PING_MS, FEED_STALL_MS } from '../../src/config.js';
import { openStream, resumeFrom } from '../../src/feed/sse.js';

import { fakeEvery, FEED_BUILD, feedServer, frameReader } from './feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
});

afterEach(async () => {
  await feed.close();
});

const DAY = 24 * 60 * 60_000;
const store = () => feed.scratch.store;

async function connect(lastEventId?: number) {
  const headers = {
    ...feed.headers('agent'),
    ...(lastEventId === undefined ? {} : { 'last-event-id': `${lastEventId}` }),
  };
  const res = await fetch(`${feed.url}/api/events`, { headers });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  return frameReader(res.body!);
}

async function frames(reader: ReturnType<typeof frameReader>, count: number, got: Frame[] = []): Promise<Frame[]> {
  if (got.length === count) return got;
  return frames(reader, count, [...got, await reader.next()]);
}

describe('GET /api/events', () => {
  it('sends each bus event with its sequence as id and its type as event', async () => {
    const reader = await connect(0);

    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    const got = await frames(reader, 4);
    expect(got.map(frame => [frame.id, frame.event])).toStrictEqual([
      ['1', 'room'],
      ['2', 'member'],
      ['3', 'member'],
      ['4', 'message'],
    ]);
    expect(got.map(frame => frame.data)).toStrictEqual(
      store()
        .events.since(0)
        .map(item => item.event),
    );
    await reader.cancel();
  });

  it('sends presence events', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    const reader = await connect(4);

    store().touch({ as: 'api', room: 'demo', state: 'waiting' });

    const [frame] = await frames(reader, 1);
    expect(frame).toStrictEqual({
      data: { from: 'active', name: 'api', room: 'demo', to: 'waiting', type: 'presence' },
      event: 'presence',
      id: '5',
    });
    await reader.cancel();
  });

  it('replays exactly the events after Last-Event-ID, then goes live', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    store().postMessage({ from: 'api', room: 'demo', text: 'missed' });
    const reader = await connect(3);

    const replayed = await frames(reader, 2);
    store().postMessage({ from: 'api', room: 'demo', text: 'live' });
    const [live] = await frames(reader, 1);

    expect(replayed.map(frame => frame.id)).toStrictEqual(['4', '5']);
    expect(replayed[1]!.data).toMatchObject({ message: { text: 'missed' }, type: 'message' });
    expect(live).toMatchObject({ data: { message: { text: 'live' } }, id: '6' });
    await reader.cancel();
  });

  it('sends a snapshot first when there is no Last-Event-ID', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    const reader = await connect();

    const [first] = await frames(reader, 1);

    expect(first!.event).toBe('snapshot');
    expect(first!.id).toBe('4');
    expect(snapshotSchema.parse(first!.data).rooms.map(room => room.name)).toStrictEqual(['demo']);
    expect(snapshotSchema.parse(first!.data).build).toStrictEqual(FEED_BUILD);
    await reader.cancel();
  });

  it.each([
    ['older than the kept log', 2],
    ['ahead of the log', 99],
  ])('sends a snapshot first for an id %s', async (_case, lastEventId) => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    feed.scratch.clock.advance(8 * DAY);
    store().postMessage({ from: 'api', room: 'demo', text: 'after a week' });
    const reader = await connect(lastEventId);

    store().postMessage({ from: 'api', room: 'demo', text: 'live' });
    const got = await frames(reader, 2);

    expect(got.map(frame => [frame.id, frame.event])).toStrictEqual([
      ['5', 'snapshot'],
      ['6', 'message'],
    ]);
    await reader.cancel();
  });

  it('pings every 15 seconds', async () => {
    const reader = await connect(0);

    feed.timer.advance(FEED_PING_MS - 1);
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    await frames(reader, 4);
    feed.timer.advance(1);
    const [ping] = await frames(reader, 1);

    expect(FEED_PING_MS).toBe(15_000);
    expect(ping).toStrictEqual({ comment: 'ping' });
    await reader.cancel();
  });

  it('stops its timer and listener when the client goes away', async () => {
    const reader = await connect(0);
    expect(feed.timer.running).toBe(1);

    await reader.cancel();

    await vi.waitFor(() => {
      expect(feed.timer.running).toBe(0);
    });
  });
});

describe('resumeFrom', () => {
  it.each([
    [undefined, { first: 1, last: 4 }, undefined],
    ['abc', { first: 1, last: 4 }, undefined],
    ['0', { first: undefined, last: 0 }, 0],
    ['0', { first: 1, last: 4 }, 0],
    ['4', { first: 1, last: 4 }, 4],
    ['5', { first: 1, last: 4 }, undefined],
    ['3', { first: 5, last: 9 }, undefined],
    ['4', { first: 5, last: 9 }, 4],
    ['3', { first: undefined, last: 9 }, undefined],
  ])('reads Last-Event-ID %s against %j as %s', (header, bounds, expected) => {
    expect(resumeFrom({ bounds, header })).toBe(expected);
  });
});

describe('openStream backpressure', () => {
  function stuckSink() {
    const listeners = new Map<string, () => void>();
    const destroy = vi.fn<() => void>(() => listeners.get('close')?.());
    const sink: Sink = {
      destroy,
      on(event, listener) {
        listeners.set(event, listener);
      },
      write: () => false,
    };
    return { destroy, drain: () => listeners.get('drain')?.(), sink };
  }

  function open(sink: Sink) {
    const timer = fakeEvery();
    let at = 0;
    const clock = {
      advance(ms: number) {
        at += ms;
        timer.advance(ms);
      },
    };
    openStream({ build: FEED_BUILD, every: timer.every, header: '0', now: () => new Date(at), sink, store: store() });
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    return { clock, timer };
  }

  it('drops a client whose buffer stays full for 30 seconds', () => {
    const { destroy, sink } = stuckSink();
    const { clock, timer } = open(sink);

    clock.advance(FEED_STALL_MS - 1);
    expect(destroy).not.toHaveBeenCalled();
    clock.advance(FEED_PING_MS);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(timer.running).toBe(0);
  });

  it('keeps a client whose buffer drains in time', () => {
    const { destroy, drain, sink } = stuckSink();
    const { clock } = open(sink);

    clock.advance(FEED_PING_MS);
    drain();
    clock.advance(FEED_STALL_MS);

    expect(destroy).not.toHaveBeenCalled();
  });
});
