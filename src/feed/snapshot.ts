import type { Snapshot } from '../../contracts/feed.ts';
import type { RoomStore } from '../rooms/store.js';

import { FEED_SNAPSHOT_MESSAGES } from '../config.js';

/** Every room with its members (those who left too, so old posts keep a sender) and last 50 messages, plus the event sequence it is current to. */
export function buildSnapshot({ store }: { store: RoomStore }) {
  const snapshot: Snapshot = {
    rooms: store.listRooms().map(room => {
      const page = store.listMessages({ limit: FEED_SNAPSHOT_MESSAGES, room: room.name });
      return { ...room, members: store.listMembers(room.name, { left: true }), messages: page.ok ? page.messages : [] };
    }),
    seq: store.events.bounds().last,
  };
  return snapshot;
}
