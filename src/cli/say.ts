import type { Command } from 'commander';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import pc from 'picocolors';

import { feedErrorSchema, humanPostResultSchema } from '../../contracts/feed.ts';
import { daemonUrl, dataDir } from '../config.js';
import { KEY_FILES, KEY_HEADER } from '../daemon/keys.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

/** The human key from the data dir, or an empty string before the daemon made one. */
export function readHumanKey(dir: string) {
  const file = path.join(dir, KEY_FILES.human);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** Posts `text` into `room` as the human through the daemon. Prints the message id, or one red line. */
export async function runSay({
  dataDir: dir,
  fetch,
  room,
  text,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  room: string;
  text: string;
  url: string;
}) {
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);

  let response: Response;
  try {
    response = await fetch(`${url}/api/rooms/${encodeURIComponent(room)}/messages`, {
      body: JSON.stringify({ text }),
      headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
      method: 'POST',
    });
  } catch {
    return fail(`messhall is down, nothing answers on ${url}. run messhall start`);
  }
  const body: unknown = await response.json().catch(() => {});
  const posted = humanPostResultSchema.safeParse(body);
  if (response.ok && posted.success) return { code: 0, output: String(posted.data.message.id) } as const;
  const refused = feedErrorSchema.safeParse(body);
  return fail(`messhall refused the post: ${refused.success ? refused.data.error : `http ${response.status}`}`);
}

/** Registers `say <room> <text>`. */
export function registerSay(program: Command) {
  program
    .command('say')
    .description('Post one message into a room as the human.')
    .argument('<room>', 'room name')
    .argument('<text>', 'what to say')
    .action(async (room: string, text: string) => {
      const result = await runSay({ dataDir: dataDir(), fetch, room, text, url: daemonUrl() });
      if (result.code === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
