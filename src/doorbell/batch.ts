import type { Member, MemberKind, Message } from '../../contracts/room.ts';
import type { RoomCount } from './rules.js';

import { RING_BATCH_MS } from '../config.js';

import { activeLately, ringsFor, ringText } from './rules.js';

export type SetTimer = (fire: () => void, ms: number) => () => void;

export interface RingBatch {
  kind: MemberKind;
  meta: Record<string, string>;
  name: string;
  rooms: string[];
  text: string;
}

interface Pending {
  cancel: () => void;
  kind: MemberKind;
  /** The newest message id held per room, to tell when the member has read it. */
  latest: Map<string, number>;
  rooms: Map<string, RoomCount>;
}

/** Real timers that never keep the process alive. */
export const realTimer: SetTimer = (fire, ms) => {
  const timer = setTimeout(fire, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * Holds rings per member name, one line per member across rooms. At fire time it drops rooms
 * the member read, and holds a member active in the last 5 s for one more batch.
 */
export function createBatcher({
  deliver,
  members,
  now,
  setTimer,
}: {
  deliver: (batch: RingBatch) => void;
  members: (room: string) => Member[];
  now: () => Date;
  setTimer: SetTimer;
}) {
  const pending = new Map<string, Pending>();
  const lastRing: Record<string, number> = {};

  function fire(name: string) {
    const batch = pending.get(name);
    if (!batch) return;
    const seats = [...batch.rooms.keys()].map(room => ({
      room,
      seat: members(room).find(member => member.name === name),
    }));
    seats
      .filter(({ room, seat }) => !seat || seat.cursor >= (batch.latest.get(room) ?? 0))
      .forEach(({ room }) => batch.rooms.delete(room));
    if (batch.rooms.size === 0) {
      pending.delete(name);
      return;
    }
    if (seats.some(({ room, seat }) => seat && batch.rooms.has(room) && activeLately({ member: seat, now: now() }))) {
      batch.cancel = setTimer(() => fire(name), RING_BATCH_MS);
      return;
    }
    pending.delete(name);
    lastRing[name] = now().getTime();
    const rooms = [...batch.rooms.values()];
    const count = rooms.reduce((sum, room) => sum + room.count, 0);
    deliver({
      kind: batch.kind,
      meta: { count: String(count), room: rooms.map(room => room.room).join(',') },
      name,
      rooms: rooms.map(room => room.room),
      text: ringText({ rooms }),
    });
  }

  return {
    /** Queues a ring for each member the message rings. */
    add({ closed, message, room }: { closed: boolean; message: Message; room: string }) {
      ringsFor({ closed, lastRing, members: members(room), message, now: now() }).forEach(ring => {
        const batch = pending.get(ring.name) ?? {
          cancel: setTimer(() => fire(ring.name), ring.at - now().getTime()),
          kind: ring.kind,
          latest: new Map<string, number>(),
          rooms: new Map<string, RoomCount>(),
        };
        pending.set(ring.name, batch);
        batch.latest.set(room, message.id);
        const counted = batch.rooms.get(room) ?? { count: 0, room };
        batch.rooms.set(room, {
          ...counted,
          count: counted.count + 1,
          ...(ring.mentionedBy && !counted.mentionedBy ? { mentionedBy: ring.mentionedBy } : {}),
        });
      });
    },
    /** Drops every pending ring. */
    stop() {
      pending.forEach(batch => batch.cancel());
      pending.clear();
    },
  };
}
