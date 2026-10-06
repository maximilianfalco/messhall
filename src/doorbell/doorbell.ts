import type { Message } from '../../contracts/room.ts';
import type { RoomStore } from '../rooms/store.js';
import type { RingBatch, SetTimer } from './batch.js';
import type { Ringers } from './ringer.js';

import { logger } from '../lib/logger.js';

import { createBatcher, realTimer } from './batch.js';

/** Rings members as messages land in the store, and for lines a loop guard pause held back once it ends. */
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
  const add = ({ message, room }: { message: Message; room: string }) =>
    batcher.add({
      closed: store.listRooms().find(item => item.name === room)?.closed_at !== null,
      message,
      pausedWith: store.pausedWith(room),
      room,
    });
  const off = store.events.on(({ event }) => {
    if (event.type === 'message') add(event);
  });
  return {
    /** Ends due loop guard pauses and rings each of the pair for the partner line it missed. Called on the sweep. */
    endPauses: () => store.endPauses().forEach(add),
    stop: () => {
      off();
      batcher.stop();
    },
  };
}
