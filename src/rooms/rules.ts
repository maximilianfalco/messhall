import type { Member, Message } from '../../contracts/room.ts';

import { ALL_MENTION, HUMAN_NAME, OBSERVER_ROLE, ORCHESTRATOR_ROLE } from '../../contracts/room.ts';
import { AWAY_AFTER_MS, IDLE_AFTER_MS } from '../config.js';

// The lookbehind keeps emails like a@b.com from reading as a mention.
const MENTION = /(?<![\w.+-])@([a-z0-9-]{1,40})(?![a-z0-9-])/g;

function splitMentions({ names, text }: { names: string[]; text: string }) {
  const known = new Set([...names, ALL_MENTION]);
  const found = Array.from(new Set(Array.from(text.matchAll(MENTION), match => match[1]!)));
  return { known: found.filter(name => known.has(name)), missing: found.filter(name => !known.has(name)) };
}

/** Names mentioned with `@` that are in `names`, plus `all`, in first-seen order. */
export function parseMentions({ names, text }: { names: string[]; text: string }) {
  return splitMentions({ names, text }).known;
}

/** Names mentioned with `@` that are not in `names`, so nobody gets rung for them. */
export function missingMentions({ names, text }: { names: string[]; text: string }) {
  return splitMentions({ names, text }).missing;
}

/** True for a member that counts as an agent: not the human seat and not an observer. */
export function isAgent(member: Pick<Member, 'kind' | 'role'>) {
  return member.kind !== 'human' && member.role !== OBSERVER_ROLE;
}

/** True when the message is one the member should answer: a mention, `@all`, the human, or a room of two agents.
 * Daemon lines, summaries and lines from the partner a member is paused with concern nobody, and nothing concerns a muted member. */
export function concerns({
  member,
  members,
  message,
  pausedWith,
}: {
  member: Member;
  members: Member[];
  message: Message;
  pausedWith: Readonly<Record<string, string>>;
}) {
  if (message.kind === 'system' || message.kind === 'summary' || message.from === member.name) return false;
  if (member.muted || pausedWith[member.name] === message.from) return false;
  if (message.mentions.includes(member.name) || message.mentions.includes(ALL_MENTION)) return true;
  if (message.from === HUMAN_NAME) return true;
  const agents = members.filter(other => isAgent(other) && other.left_at === null).map(other => other.name);
  return agents.length === 2 && agents.includes(member.name) && agents.includes(message.from);
}

/**
 * The two agents behind the last `lines` posts, when nobody else spoke and nobody said done in that run.
 * Null otherwise. Posts come oldest first.
 */
export function loopPair({ lines, posts }: { lines: number; posts: Message[] }) {
  const run = posts.slice(-lines);
  if (run.length < lines || run.some(post => post.kind !== 'chat' || post.from === HUMAN_NAME)) return null;
  const [a, b, ...rest] = new Set(run.map(post => post.from));
  return a && b && !rest.length ? ([a, b] as const) : null;
}

/** Presence after time passes with no call. Active turns idle at 2 minutes, anything turns away at 30. */
export function nextPresence({ member, now }: { member: Pick<Member, 'last_seen_at' | 'presence'>; now: Date }) {
  const silent = now.getTime() - Date.parse(member.last_seen_at);
  if (silent >= AWAY_AFTER_MS) return 'away';
  if (member.presence === 'active' && silent >= IDLE_AFTER_MS) return 'idle';
  return member.presence;
}

/** Only the human seat and an orchestrator hand out roles, mutes or kick, so an agent cannot promote itself. */
export function canAssignRole({ by }: { by: Pick<Member, 'kind' | 'role'> }) {
  return by.kind === 'human' || by.role === ORCHESTRATOR_ROLE;
}
