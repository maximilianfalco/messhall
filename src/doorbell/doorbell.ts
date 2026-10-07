import type { Message } from '../../contracts/room.ts';
import type { RoomStore } from '../rooms/store.js';
import type { RingBatch, SetTimer } from './batch.js';
import type { Ringers } from './ringer.js';

import { REVIEW_STALE_MS } from '../config.js';
import { logger } from '../lib/logger.js';

import { createBatcher, realTimer } from './batch.js';

/**
 * Rings members as messages land in the store, and for lines a loop guard pause held back once it ends.
 * A ring no session takes is held, newest per name, and sent when the member sits down again.
 */
export function startDoorbell({
  now,
  ringers,
  setTimer = realTimer,
  store,
}: {
  now: () => Date;
  ringers: Ringers;
  setTimer?: SetTimer;
  store: RoomStore;
}) {
  const held = new Map<string, RingBatch>();
  // Request ids already rung again, so each request gets one extra ring. A restart may ring one more time.
  const nudged = new Set<number>();
  const deliver = (batch: RingBatch) => {
    const { kind, meta, name, rooms, text } = batch;
    const ringer = ringers.for(kind);
    if (!ringer) return;
    ringer.ring({ member: { name, rooms }, meta, text }).then(
      ({ sessions, unconfirmed }) => {
        const line = { kind, name, rooms: rooms.join(','), sessions, text };
        // A session that never answered its check may be a plain claude that drops the ring.
        if (sessions > 0) {
          return logger.info(unconfirmed === sessions ? 'doorbell rang, unconfirmed' : 'doorbell rang', line);
        }
        held.set(name, batch);
        logger.info('doorbell held, no session', line);
      },
      (error: unknown) =>
        logger.error(error instanceof Error ? error : new Error(String(error)), { message: 'ring failed' }),
    );
  };
  const batcher = createBatcher({ deliver, members: room => store.listMembers(room), now, setTimer });
  const add = ({ message, room }: { message: Message; room: string }) =>
    batcher.add({
      closed: store.listRooms().find(item => item.name === room)?.closed_at !== null,
      message,
      pausedWith: store.pausedWith(room),
      room,
    });
  const off = store.events.on(({ event }) => {
    if (event.type === 'message') add(event);
    if (event.type !== 'member') return;
    const batch = held.get(event.member.name);
    if (!batch || !batch.rooms.includes(event.room)) return;
    if (event.change === 'left' || event.change === 'removed') held.delete(event.member.name);
    if (event.change !== 'joined' && event.change !== 'reconnected') return;
    held.delete(event.member.name);
    // The join binds its session right after this event, so the ring waits one tick for it.
    setTimer(() => deliver(batch), 0);
  });
  return {
    /** Ends due loop guard pauses and rings each of the pair for the partner line it missed. Called on the sweep. */
    endPauses: () => store.endPauses().forEach(add),
    /** Posts due review hand-off lines and rings each reviewer quiet 10 minutes once more. Called on the sweep. */
    nudgeReviews: () =>
      store
        .nudgeReviews()
        .filter(({ id }) => !nudged.has(id))
        .forEach(({ id, kind, reviewer, room, url, worker }) => {
          nudged.add(id);
          const wait = REVIEW_STALE_MS / 60_000;
          const text = `messhall: ${worker} has waited ${wait} min on your review of ${url} in #${room}. Answer it, or say who should.`;
          deliver({ kind, meta: { room }, name: reviewer, rooms: [room], text });
        }),
    stop: () => {
      off();
      batcher.stop();
      held.clear();
    },
  };
}
