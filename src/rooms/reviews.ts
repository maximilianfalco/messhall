import type { Member, Message } from '../../contracts/room.ts';

import { HUMAN_NAME, ORCHESTRATOR_ROLE, REVIEWER_ROLE } from '../../contracts/room.ts';
import { REVIEW_HANDOFF_MS, REVIEW_NUDGE_WINDOW_MS, REVIEW_STALE_MS } from '../config.js';

import { isLive } from './rules.js';

const PR_URL = String.raw`https://github\.com/[\w.-]+/[\w.-]+/pull/\d+(?!\d)`;
// A request may sit on any line of a post, or follow a short sentence like `CI green. ready for review: ...`.
const REQUEST = new RegExp(
  String.raw`(?:^|[.!?])\s*(?:ready for review|round (\d+)):\s*(${PR_URL})\b.*?@([a-z0-9-]{1,40})`,
  'im',
);

const urlsIn = (text: string) => Array.from(text.matchAll(new RegExp(PR_URL, 'g')), ([url]) => url);

export type ReviewState = 'answered' | 'stale' | 'waiting';

export type ReviewNudge =
  | { id: number; kind: 'line'; mentions: string[]; text: string }
  | { id: number; kind: 'ring'; reviewer: string; url: string; worker: string };

export interface RoomLine {
  created_at: string;
  from: string;
  id: number;
  text: string;
}

/** Reads `ready for review: <url> @reviewer` (round 1) or `round N: <url> @reviewer`, at the start of a sentence. Anything else is not a request. */
export function reviewRequest(line: string) {
  const match = REQUEST.exec(line);
  if (!match) return;
  const [, round, url, reviewer] = match;
  return { reviewer: reviewer!, round: round ? Number(round) : 1, url: url! };
}

function latestRequests<Line extends RoomLine>(messages: Line[]) {
  const latest = new Map<string, Line & NonNullable<ReturnType<typeof reviewRequest>>>();
  for (const message of messages) {
    const request = reviewRequest(message.text);
    if (request) latest.set(request.url, { ...message, ...request });
  }
  return [...latest.values()];
}

const namesUrl = ({ line, url, worker }: { line: RoomLine; url: string; worker: string }) =>
  line.from !== worker && urlsIn(line.text).includes(url);

/** The latest request per PR, oldest first. A later line naming the url from anyone but the worker answers it. */
export function reviewQueue({ messages, now }: { messages: RoomLine[]; now: Date }) {
  return latestRequests(messages).map(({ created_at: at, from, id, reviewer, round, url }) => {
    const answered = messages.some(line => line.id > id && namesUrl({ line, url, worker: from }));
    const age = now.getTime() - Date.parse(at);
    const state: ReviewState = answered ? 'answered' : age >= REVIEW_STALE_MS ? 'stale' : 'waiting';
    return { ageMin: Math.floor(age / 60_000), from, id, reviewer, round, state, url };
  });
}

/** Who a stale request goes to: the other live reviewers, else a live orchestrator, else the human. */
function handoffTargets({ members, reviewer, worker }: { members: Member[]; reviewer: string; worker: string }) {
  const live = members.filter(isLive);
  const reviewers = live.filter(
    member => member.role === REVIEWER_ROLE && member.name !== reviewer && member.name !== worker,
  );
  if (reviewers.length) return reviewers.map(member => member.name);
  const orchestrator = live.find(member => member.role === ORCHESTRATOR_ROLE);
  return [orchestrator?.name ?? HUMAN_NAME];
}

/**
 * What to do about each unanswered review request: ring its reviewer again at 10 minutes, hand it to
 * others in one line at 15. A reply from the reviewer to the worker, or any line naming the url, answers it.
 * That includes the hand-off line itself, so a request gets one line at most.
 */
export function reviewNudges({ members, messages, now }: { members: Member[]; messages: Message[]; now: Date }) {
  return latestRequests(messages).flatMap<ReviewNudge>(({ created_at: at, from: worker, id, reviewer, url }) => {
    const age = now.getTime() - Date.parse(at);
    if (age < REVIEW_STALE_MS || age >= REVIEW_NUDGE_WINDOW_MS) return [];
    const answered = messages.some(
      line =>
        line.id > id && (namesUrl({ line, url, worker }) || (line.from === reviewer && line.mentions.includes(worker))),
    );
    if (answered) return [];
    if (age < REVIEW_HANDOFF_MS) return [{ id, kind: 'ring', reviewer, url, worker }];
    const mentions = handoffTargets({ members, reviewer, worker });
    const ask = mentions.length > 1 ? 'can one of you take it' : 'can you take it';
    const text = `${mentions.map(name => `@${name}`).join(' ')} ${url} waited ${REVIEW_HANDOFF_MS / 60_000} min on ${reviewer}, ${ask}`;
    return [{ id, kind: 'line', mentions, text }];
  });
}
