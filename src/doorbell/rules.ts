import type { Member, MemberKind, Message } from '../../contracts/room.ts';

import { RING_ACTIVE_HOLD_MS, RING_BATCH_MS, RING_THROTTLE_MS } from '../config.js';
import { concerns } from '../rooms/rules.js';

export interface Ring {
  at: number;
  kind: MemberKind;
  mentionedBy?: string;
  name: string;
}

export interface RoomCount {
  count: number;
  mentionedBy?: string;
  room: string;
}

/**
 * Who a message rings and when: members it concerns, minus the poster, the human and anyone
 * blocked in wait. Rings land 3 s out, or 20 s after the last ring.
 */
export function ringsFor({
  closed,
  lastRing,
  members,
  message,
  now,
}: {
  closed: boolean;
  lastRing: Readonly<Record<string, number>>;
  members: Member[];
  message: Message;
  now: Date;
}) {
  if (closed) return [];
  const at = now.getTime();
  return members
    .filter(member => member.kind !== 'human' && member.presence !== 'waiting')
    .filter(member => concerns({ member, members, message }))
    .map(member => {
      const ring: Ring = {
        at: Math.max(at + RING_BATCH_MS, (lastRing[member.name] ?? -Infinity) + RING_THROTTLE_MS),
        kind: member.kind,
        name: member.name,
      };
      if (message.mentions.includes(member.name)) ring.mentionedBy = message.from;
      return ring;
    });
}

/** True for a member that made a call in the last 5 s. It may read soon, so its ring waits. */
export function activeLately({ member, now }: { member: Member; now: Date }) {
  return member.presence === 'active' && now.getTime() - Date.parse(member.last_seen_at) < RING_ACTIVE_HOLD_MS;
}

/** The one-line ring. Never the content, only counts, so a bell costs the agent almost no context. */
export function ringText({ rooms }: { rooms: RoomCount[] }) {
  const [first, ...rest] = rooms;
  if (!first) return '';
  const lead = `${first.count} new in #${first.room}`;
  if (rest.length === 0) {
    return `messhall: ${lead}${first.mentionedBy ? `, ${first.mentionedBy} mentioned you` : ''}. Call read_since.`;
  }
  return `messhall: ${[lead, ...rest.map(room => `${room.count} in #${room.room}`)].join(', ')}. Call read_since.`;
}
