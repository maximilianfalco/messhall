import type { TranscriptMessage } from '../feed/transcript.js';
import type { Command } from 'commander';

import { writeFileSync } from 'node:fs';

import pc from 'picocolors';
import { z } from 'zod';

import { feedErrorSchema } from '../../contracts/feed.ts';
import { memberSchema, messageSchema, roomSummarySchema } from '../../contracts/room.ts';
import { daemonUrl, dataDir, FEED_PAGE_MAX } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';
import { renderTranscript } from '../feed/transcript.js';

import { readHumanKey } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// Loose on purpose: the snapshot's messages and new kinds like summary must not break an export.
const headerSchema = z.object({ rooms: z.array(roomSummarySchema.extend({ members: z.array(memberSchema) })) });
const pageSchema = z.object({ messages: z.array(messageSchema.extend({ kind: z.string() })) });

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

/** Reads one room's header and full history from the daemon and renders it as markdown, to `out` or as output. */
export async function runExport({
  dataDir: dir,
  fetch,
  out,
  pageSize = FEED_PAGE_MAX,
  room,
  since = 0,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  out?: string;
  pageSize?: number;
  room: string;
  since?: number;
  url: string;
}) {
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);

  const down = `messhall is down, nothing answers on ${url}. run messhall start`;
  const get = async (route: string) => {
    const response = await fetch(`${url}${route}`, { headers: { [KEY_HEADER]: key } }).catch(() => {});
    if (!response) return { error: down, ok: false } as const;
    const body: unknown = await response.json().catch(() => {});
    if (response.ok) return { body, ok: true } as const;
    const refused = feedErrorSchema.safeParse(body);
    const error = `messhall refused the export: ${refused.success ? refused.data.error : `http ${response.status}`}`;
    return { error, ok: false } as const;
  };

  const snapshot = await get('/api/snapshot');
  if (!snapshot.ok) return fail(snapshot.error);
  const header = headerSchema.parse(snapshot.body).rooms.find(item => item.name === room);
  if (!header) return fail(`no room #${room}`);

  const readFrom = async (
    after: number,
  ): Promise<{ error: string; ok: false } | { messages: TranscriptMessage[]; ok: true }> => {
    const page = await get(`/api/rooms/${encodeURIComponent(room)}/messages?after=${after}&limit=${pageSize}`);
    if (!page.ok) return page;
    const batch = pageSchema.parse(page.body).messages;
    const last = batch.at(-1);
    if (!last || batch.length < pageSize) return { messages: batch, ok: true };
    const rest = await readFrom(last.id);
    return rest.ok ? { messages: [...batch, ...rest.messages], ok: true } : rest;
  };
  const history = await readFrom(since);
  if (!history.ok) return fail(history.error);
  const { messages } = history;

  const markdown = renderTranscript({ members: header.members, messages, room: header });
  if (!out) return { code: 0, output: markdown } as const;
  writeFileSync(out, markdown);
  return { code: 0, output: `wrote ${messages.length} messages to ${out}` } as const;
}

/** Registers `export <room> [--since <id>] [--out <file>]`. */
export function registerExport(program: Command) {
  program
    .command('export')
    .description('Write a room as markdown, to stdout or a file.')
    .argument('<room>', 'room name')
    .option('--since <id>', 'only messages after this id', Number)
    .option('--out <file>', 'write to this file instead of stdout')
    .action(async (room: string, options: { out?: string; since?: number }) => {
      const result = await runExport({ dataDir: dataDir(), fetch, room, url: daemonUrl(), ...options });
      if (result.code === 0) process.stdout.write(options.out ? `${result.output}\n` : result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
