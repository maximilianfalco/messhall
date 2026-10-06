import type { RoomStore } from '../rooms/store.js';
import type { RingBatch, SetTimer } from './batch.js';
import type { Ringers } from './ringers.js';

import { logger } from '../lib/logger.js';

import { createBatcher, realTimer } from './batch.js';

/** Rings members as messages land in the store. Returns a function that stops it. */
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
  const deliver = ({ kind, meta, name, rooms, text }: RingBatch) => {
    const ringer = ringers.for(kind);
    if (!ringer) return;
    ringer.ring({ member: { name, rooms }, meta, text }).then(
      sessions => logger.info('doorbell rang', { kind, name, rooms: rooms.join(','), sessions, text }),
      (error: unknown) =>
        logger.error(error instanceof Error ? error : new Error(String(error)), { message: 'ring failed' }),
    );
  };
  const batcher = createBatcher({ deliver, members: room => store.listMembers(room), now, setTimer });
  const off = store.events.on(({ event }) => {
    if (event.type !== 'message') return;
    const room = store.listRooms().find(item => item.name === event.room);
    batcher.add({
      closed: room?.closed_at !== null,
      message: event.message,
      room: event.room,
    });
  });
  return () => {
    off();
    batcher.stop();
  };
}
