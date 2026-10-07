import type { Snapshot } from '../../contracts/feed.ts';
import type { RoomStore } from '../rooms/store.js';

import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import { CLI_VERSION, FEED_SNAPSHOT_MESSAGES } from '../config.js';

/** Every room with its pending tool asks and open questions, its members (those who left too, so old posts keep a sender) and last 50 messages, plus the event sequence it is current to and the daemon and contract versions. */
export function buildSnapshot({ store }: { store: RoomStore }) {
  const snapshot: Snapshot = {
    contract_version: FEED_CONTRACT_VERSION,
    rooms: store.listRooms().map(room => {
      const page = store.listMessages({ limit: FEED_SNAPSHOT_MESSAGES, room: room.name });
      return {
        ...room,
        approvals: store.pendingApprovals(room.name),
        members: store.listMembers(room.name, { left: true }),
        messages: page.ok ? page.messages : [],
        questions: store.openQuestions(room.name),
      };
    }),
    seq: store.events.bounds().last,
    version: CLI_VERSION,
  };
  return snapshot;
}
