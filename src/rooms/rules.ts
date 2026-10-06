import type { Member, Message } from '../../contracts/room.ts';

import { ALL_MENTION, HUMAN_NAME } from '../../contracts/room.ts';
import { CAP_WARN_RATIO, GONE_AFTER_MS, IDLE_AFTER_MS } from '../config.js';

// The lookbehind keeps emails like a@b.com from reading as a mention.
const MENTION = /(?<![\w.+-])@([a-z0-9-]{1,40})(?![a-z0-9-])/g;

/** Names mentioned with `@` that are in `names`, plus `all`, in first-seen order. */
export function parseMentions({ names, text }: { names: string[]; text: string }) {
  const known = new Set([...names, ALL_MENTION]);
  const found = Array.from(text.matchAll(MENTION), match => match[1]!).filter(name => known.has(name));
  return Array.from(new Set(found));
}

/** True when the message is one the member should answer: a mention, `@all`, the human, or a room of two agents. */
export function concerns({ member, members, message }: { member: Member; members: Member[]; message: Message }) {
  if (message.kind === 'system' || message.from === member.name) return false;
  if (message.mentions.includes(member.name) || message.mentions.includes(ALL_MENTION)) return true;
  if (message.from === HUMAN_NAME) return true;
  const agents = members.filter(other => other.kind !== 'human' && other.left_at === null).map(other => other.name);
  return agents.length === 2 && agents.includes(member.name) && agents.includes(message.from);
}

/** Where a room stands after `count` posts: a warning once at 80 percent, full at the cap. */
export function capState({ cap, count }: { cap: number; count: number }) {
  if (count >= cap) return 'full';
  return count === Math.floor(cap * CAP_WARN_RATIO) ? 'warn' : 'open';
}

/** Presence after time passes with no call. Active turns idle at 2 minutes, anything turns gone at 30. */
export function nextPresence({ member, now }: { member: Pick<Member, 'last_seen_at' | 'presence'>; now: Date }) {
  const silent = now.getTime() - Date.parse(member.last_seen_at);
  if (silent >= GONE_AFTER_MS) return 'gone';
  if (member.presence === 'active' && silent >= IDLE_AFTER_MS) return 'idle';
  return member.presence;
}
