// A request nobody answered in this long goes to any free reviewer.
export const STALE_AFTER_MS = 10 * 60_000;

const PR_URL = String.raw`https://github\.com/[\w.-]+/[\w.-]+/pull/\d+(?!\d)`;
const REQUEST = new RegExp(String.raw`^\s*(?:ready for review|round (\d+)):\s*(${PR_URL})\b.*?@([a-z0-9-]{1,40})`, 'i');

const urlsIn = (text: string) => Array.from(text.matchAll(new RegExp(PR_URL, 'g')), ([url]) => url);

export type ReviewState = 'answered' | 'stale' | 'waiting';

export interface RoomLine {
  created_at: string;
  from: string;
  id: number;
  text: string;
}

/** Reads `ready for review: <url> @reviewer` (round 1) or `round N: <url> @reviewer`. Anything else is not a request. */
export function reviewRequest(line: string) {
  const match = REQUEST.exec(line);
  if (!match) return;
  const [, round, url, reviewer] = match;
  return { reviewer: reviewer!, round: round ? Number(round) : 1, url: url! };
}

/** The latest request per PR, oldest first. A later line naming the url from anyone but the worker answers it. */
export function reviewQueue({ messages, now }: { messages: RoomLine[]; now: Date }) {
  const latest = new Map<string, RoomLine & NonNullable<ReturnType<typeof reviewRequest>>>();
  for (const message of messages) {
    const request = reviewRequest(message.text);
    if (request) latest.set(request.url, { ...message, ...request });
  }
  return [...latest.values()].map(({ created_at: at, from, id, reviewer, round, url }) => {
    const answered = messages.some(line => line.id > id && line.from !== from && urlsIn(line.text).includes(url));
    const age = now.getTime() - Date.parse(at);
    const state: ReviewState = answered ? 'answered' : age >= STALE_AFTER_MS ? 'stale' : 'waiting';
    return { ageMin: Math.floor(age / 60_000), from, id, reviewer, round, state, url };
  });
}
