import type { SequencedEvent } from '../../contracts/events.ts';
import type { Build } from '../../contracts/health.ts';
import type { Handler } from '../daemon/router.js';
import type { RoomStore } from '../rooms/store.js';

import { SNAPSHOT_EVENT } from '../../contracts/feed.ts';
import { FEED_PING_MS, FEED_STALL_MS } from '../config.js';

import { buildSnapshot } from './snapshot.js';

/** Calls `tick` every `ms` until the returned function is called. */
export type Every = (ms: number, tick: () => void) => () => void;

/** The part of a response the stream writes to. */
export interface Sink {
  destroy(): void;
  on(event: 'close' | 'drain', listener: () => void): unknown;
  write(chunk: string): boolean;
}

export const intervalTimer: Every = (ms, tick) => {
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
};

const frame = ({ data, event, id }: { data: unknown; event: string; id: number }) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const eventFrame = ({ event, seq }: SequencedEvent) => frame({ data: event, event: event.type, id: seq });

/** The sequence to replay after, or undefined when the client needs a snapshot first: no id,
 * a bad one, one from a newer log, or one whose next events were already dropped. */
export function resumeFrom({
  bounds,
  header,
}: {
  bounds: { first: number | undefined; last: number };
  header: string | string[] | undefined;
}) {
  if (typeof header !== 'string' || !/^\d+$/.test(header)) return;
  const id = Number(header);
  if (id > bounds.last) return;
  if (id < bounds.last && (bounds.first ?? Infinity) > id + 1) return;
  return id;
}

/** Writes the replay or a snapshot, then every new event, with a ping every 15 s. A client whose
 * buffer stays full for 30 s is dropped, so one stuck reader cannot grow the daemon's memory. */
export function openStream({
  build,
  every,
  header,
  now,
  sink,
  store,
}: {
  build: Build | null;
  every: Every;
  header: string | string[] | undefined;
  now: () => Date;
  sink: Sink;
  store: RoomStore;
}) {
  let stalledAt: number | undefined;
  const send = (chunk: string) => {
    if (!sink.write(chunk)) stalledAt ??= now().getTime();
  };

  const after = resumeFrom({ bounds: store.events.bounds(), header });
  if (after === undefined) {
    const snapshot = buildSnapshot({ build, store });
    send(frame({ data: snapshot, event: SNAPSHOT_EVENT, id: snapshot.seq }));
  } else {
    store.events.since(after).forEach(event => send(eventFrame(event)));
  }
  // Replay and subscribe run in one tick, so no event can fall between them.
  const off = store.events.on(event => send(eventFrame(event)));
  const stop = every(FEED_PING_MS, () => {
    if (stalledAt === undefined) send(': ping\n\n');
    else if (now().getTime() - stalledAt >= FEED_STALL_MS) sink.destroy();
  });
  sink.on('drain', () => {
    stalledAt = undefined;
  });
  sink.on('close', () => {
    off();
    stop();
  });
}

/** `GET /api/events`: the SSE feed, resumed from `Last-Event-ID` when the log still has it. */
export function eventStream({
  build,
  every,
  now,
  store,
}: {
  build: Build | null;
  every: Every;
  now: () => Date;
  store: RoomStore;
}) {
  return ((req, res) => {
    res.writeHead(200, { 'cache-control': 'no-cache', connection: 'keep-alive', 'content-type': 'text/event-stream' });
    res.flushHeaders();
    openStream({ build, every, header: req.headers['last-event-id'], now, sink: res, store });
  }) satisfies Handler;
}
