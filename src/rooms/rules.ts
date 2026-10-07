import type { Member, Message } from '../../contracts/room.ts';

import { ALL_MENTION, HUMAN_NAME, OBSERVER_ROLE, ORCHESTRATOR_ROLE } from '../../contracts/room.ts';
import { AWAY_AFTER_MS, IDLE_AFTER_MS, RECONNECT_MS } from '../config.js';

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

function isLive(member: Member) {
  return member.left_at === null && !member.muted && member.presence !== 'away';
}

/** True when the member should answer: a mention, `@all`, a room of two agents, or the human (only the live orchestrator when it names nobody).
 * A daemon line concerns only who it names. Summaries and lines from a paused partner concern nobody, nor does anything a muted member. */
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
  if (message.kind === 'summary' || message.from === member.name) return false;
  if (member.muted || pausedWith[member.name] === message.from) return false;
  if (message.kind === 'system') return message.mentions.includes(member.name);
  if (message.mentions.includes(member.name) || message.mentions.includes(ALL_MENTION)) return true;
  if (message.from === HUMAN_NAME) {
    const router = members.find(other => other.role === ORCHESTRATOR_ROLE && isLive(other));
    if (!router) return true;
    return message.mentions.length === 0 && member.name === router.name;
  }
  const agents = members.filter(other => isAgent(other) && other.left_at === null).map(other => other.name);
  return agents.length === 2 && agents.includes(member.name) && agents.includes(message.from);
}

/**
 * The two agents trading lines alone at the end of `posts`: `lines` of them within `withinMs`, or `backstop` at any pace.
 * A human line, a third agent, a done or a line to the human ends the run. Null otherwise. Posts come oldest first.
 */
export function loopPair({
  backstop,
  lines,
  posts,
  withinMs,
}: {
  backstop: number;
  lines: number;
  posts: Message[];
  withinMs: number;
}) {
  const run: Message[] = [];
  const froms = new Set<string>();
  for (const post of posts.toReversed()) {
    if (run.length === backstop || post.kind !== 'chat' || post.from === HUMAN_NAME) break;
    if (post.mentions.includes(HUMAN_NAME) || (froms.size === 2 && !froms.has(post.from))) break;
    froms.add(post.from);
    run.unshift(post);
  }
  const [a, b] = new Set(run.map(post => post.from));
  if (!a || !b) return null;
  const pair = [a, b] as const;
  if (run.length >= backstop) return { fast: false, lines: backstop, pair };
  const last = run.slice(-lines);
  const span = last.length && Date.parse(last.at(-1)!.created_at) - Date.parse(last[0]!.created_at);
  return last.length >= lines && span <= withinMs ? { fast: true, lines, pair } : null;
}

/** Presence after time passes with no call. Active turns idle at 2 minutes, anything turns away at 30.
 * A seat its doorbell can still ring stays idle instead, since a mention still reaches it.
 * A reconnecting seat turns away 2 minutes after `restartedAt`, since its last call came before the restart. */
export function nextPresence({
  member,
  now,
  restartedAt,
  ringable,
}: {
  member: Pick<Member, 'last_seen_at' | 'presence'>;
  now: Date;
  restartedAt?: Date;
  ringable: boolean;
}) {
  if (member.presence === 'reconnecting') {
    return restartedAt && now.getTime() - restartedAt.getTime() < RECONNECT_MS ? 'reconnecting' : 'away';
  }
  const silent = now.getTime() - Date.parse(member.last_seen_at);
  if (silent >= AWAY_AFTER_MS) return ringable ? 'idle' : 'away';
  if (member.presence === 'active' && silent >= IDLE_AFTER_MS) return 'idle';
  return member.presence;
}

/** Only the human seat and an orchestrator hand out roles, mutes or kick, so an agent cannot promote itself. */
export function canAssignRole({ by }: { by: Pick<Member, 'kind' | 'role'> }) {
  return by.kind === 'human' || by.role === ORCHESTRATOR_ROLE;
}
