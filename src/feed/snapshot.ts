import type { Snapshot } from '../../contracts/feed.ts';
import type { Build } from '../../contracts/health.ts';
import type { RoomStore } from '../rooms/store.js';

import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import { CLI_VERSION, FEED_SNAPSHOT_MESSAGES } from '../config.js';

/** Every room with its pending tool asks, open questions, the settled ones asked in that page and live agreements, its members (those who left too, so old posts keep a sender) and last 50 messages, plus the event sequence it is current to and the daemon's build and contract versions. */
export function buildSnapshot({ build, store }: { build: Build | null; store: RoomStore }) {
  const snapshot: Snapshot = {
    build,
    contract_version: FEED_CONTRACT_VERSION,
    rooms: store.listRooms().map(room => {
      const page = store.listMessages({ limit: FEED_SNAPSHOT_MESSAGES, room: room.name });
      const messages = page.ok ? page.messages : [];
      return {
        ...room,
        agreements: store.agreementsIn(room.name),
        approvals: store.pendingApprovals(room.name),
        members: store.listMembers(room.name, { left: true }),
        messages,
        questions: store.openQuestions(room.name),
        settled_questions: store.settledQuestions(room.name, { fromMessage: messages[0]?.id ?? 0 }),
      };
    }),
    seq: store.events.bounds().last,
    version: CLI_VERSION,
  };
  return snapshot;
}
