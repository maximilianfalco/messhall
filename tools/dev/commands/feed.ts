import type { BusEvent } from '../../../contracts/events.ts';
import type { Snapshot } from '../../../contracts/feed.ts';
import type { Frame } from '../../../src/lib/sse.js';
import type { Command } from 'commander';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { busEventSchema } from '../../../contracts/events.ts';
import { SNAPSHOT_EVENT, snapshotSchema } from '../../../contracts/feed.ts';
import { daemonUrl, dataDir } from '../../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../../src/daemon/keys.js';
import { parseStoredJson } from '../../../src/lib/json.js';
import { readFrames } from '../../../src/lib/sse.js';
import { bad, dim } from '../lib/print.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const LABEL_WIDTH = 10;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function snapshotLine(snapshot: Snapshot, room: string | undefined) {
  const rooms = snapshot.rooms.filter(item => !room || item.name === room);
  const parts = rooms.map(
    item => `#${item.name} ${plural(item.members.length, 'member')}, ${plural(item.messages.length, 'message')}`,
  );
  return `${plural(rooms.length, 'room')}: ${parts.join('; ') || 'none'}`;
}

function eventLine(event: BusEvent) {
  if (event.type === 'message') {
    const { from, id, mentions, text } = event.message;
    const to = mentions.length ? ` → ${mentions.map(name => `@${name}`).join(' ')}` : '';
    return `#${event.room} [#${id} ${from}${to}] ${text}`;
  }
  if (event.type === 'member') return `#${event.room} ${event.member.name} ${event.change} (${event.member.kind})`;
  if (event.type === 'presence') return `#${event.room} ${event.name} ${event.from} → ${event.to}`;
  if (event.type === 'approval') {
    const { id, member, state, tool } = event.approval;
    return `#${event.room} ${member} ${tool} ${state} (${id})`;
  }
  if (event.type === 'question') {
    const { id, member, state } = event.question;
    return `#${event.room} ${member} question ${state} (${id})`;
  }
  if (event.type === 'agreement') {
    const { id, proposer, state } = event.agreement;
    return `#${event.room} ${proposer} agreement ${state} (${id})`;
  }
  if (event.type === 'message_edit') return `#${event.room} edit #${event.message.id}`;
  return `#${event.room.name} ${event.change}`;
}

const roomOf = (event: BusEvent) => (event.type === 'room' ? event.room.name : event.room);

/** One printable line for a frame, or undefined when `room` filters it out. */
function frameLine(frame: Frame, room: string | undefined) {
  const label = `${dim(`#${frame.id}`)} ${frame.event.padEnd(LABEL_WIDTH)}`;
  const data = parseStoredJson(frame.data);
  if (frame.event === SNAPSHOT_EVENT) {
    return `${label}${snapshotLine(snapshotSchema.parse(data), room)}`;
  }
  const event = busEventSchema.parse(data);
  if (room && roomOf(event) !== room) return;
  return `${label}${eventLine(event)}`;
}

/** Tails `GET /api/events` and prints one line per event until `count` lines. Returns the exit code. */
export async function tailFeed({
  count,
  fetch,
  key,
  print,
  room,
  since,
  url,
}: {
  count?: number;
  fetch: Fetch;
  key: string;
  print: (line: string) => void;
  room?: string;
  since?: number;
  url: string;
}) {
  const controller = new AbortController();
  let response: Response;
  try {
    response = await fetch(`${url}/api/events`, {
      headers: { [KEY_HEADER]: key, ...(since === undefined ? {} : { 'last-event-id': String(since) }) },
      signal: controller.signal,
    });
  } catch {
    print(bad(`messhall is down, nothing answers on ${url}`));
    return 1;
  }
  if (!response.ok || !response.body) {
    print(bad(`the feed answered ${response.status}`));
    return 1;
  }

  let printed = 0;
  for await (const frame of readFrames(response.body)) {
    const line = frameLine(frame, room);
    if (line) {
      print(line);
      printed += 1;
    }
    if (count !== undefined && printed >= count) break;
  }
  controller.abort();
  return 0;
}

/** Registers `feed [--room <r>] [--url <u>] [--since <seq>] [--count <n>]`. */
export function registerFeed(program: Command) {
  program
    .command('feed')
    .description('Tail the live SSE feed of the running daemon, one line per event.')
    .option('--room <room>', 'only this room')
    .option('--url <url>', 'daemon url, MESSHALL_PORT or 7707 by default')
    .option('--since <seq>', 'replay the events after this sequence instead of a snapshot', Number)
    .option('--count <n>', 'exit after this many lines', Number)
    .action(async (options: { count?: number; room?: string; since?: number; url?: string }) => {
      const url = options.url ?? daemonUrl();
      let key: string;
      try {
        key = readFileSync(path.join(dataDir(), KEY_FILES.human), 'utf8').trim();
      } catch {
        console.log(bad(`no human key in ${dataDir()}, start the daemon once`));
        process.exitCode = 1;
        return;
      }
      process.exitCode = await tailFeed({ ...options, fetch, key, print: line => console.log(line), url });
    });
}
