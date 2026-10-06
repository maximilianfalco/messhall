import type { Member, MemberKind, Message } from '../../contracts/room.ts';
import type { RoomCount } from './rules.js';

import { ringsFor, ringText } from './rules.js';

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
  rooms: Map<string, RoomCount>;
}

/** Real timers that never keep the process alive. */
export const realTimer: SetTimer = (fire, ms) => {
  const timer = setTimeout(fire, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * Holds rings per member name and fires one per member, folding every room it gathered.
 * Members are keyed by name, so one role in two rooms gets one line.
 */
export function createBatcher({
  deliver,
  now,
  setTimer,
}: {
  deliver: (batch: RingBatch) => void;
  now: () => Date;
  setTimer: SetTimer;
}) {
  const pending = new Map<string, Pending>();
  const lastRing: Record<string, number> = {};

  function fire(name: string) {
    const batch = pending.get(name);
    if (!batch) return;
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
    add({ closed, members, message, room }: { closed: boolean; members: Member[]; message: Message; room: string }) {
      ringsFor({ closed, lastRing, members, message, now: now() }).forEach(ring => {
        const batch = pending.get(ring.name) ?? {
          cancel: setTimer(() => fire(ring.name), ring.at - now().getTime()),
          kind: ring.kind,
          rooms: new Map<string, RoomCount>(),
        };
        pending.set(ring.name, batch);
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
