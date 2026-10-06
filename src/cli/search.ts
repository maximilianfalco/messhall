import type { Command } from 'commander';

import pc from 'picocolors';

import { feedErrorSchema, searchResultSchema } from '../../contracts/feed.ts';
import { daemonUrl, dataDir, SEARCH_LIMIT } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

import { readHumanKey } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;
const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

/** Finds messages with every word of `q` through the daemon, one `#room  HH:MM  from  text` line each. */
export async function runSearch({
  dataDir: dir,
  fetch,
  limit = SEARCH_LIMIT,
  q,
  room,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  limit?: number;
  q: string;
  room?: string;
  url: string;
}) {
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);

  const query = new URLSearchParams({ limit: String(limit), q, ...(room ? { room } : {}) });
  const response = await fetch(`${url}/api/search?${query}`, { headers: { [KEY_HEADER]: key } }).catch(() => {});
  if (!response) return fail(`messhall is down, nothing answers on ${url}. run messhall start`);
  const body: unknown = await response.json().catch(() => {});
  if (!response.ok) {
    const refused = feedErrorSchema.safeParse(body);
    return fail(`messhall refused the search: ${refused.success ? refused.data.error : `http ${response.status}`}`);
  }
  const { messages } = searchResultSchema.parse(body);
  if (!messages.length) return { code: 0, output: pc.dim(`no messages match "${q}"`) } as const;
  const lines = messages.map(
    message =>
      `${pc.bold(`#${message.room}`)}  ${pc.dim(clock(message.created_at))}  ${pc.cyan(message.from)}  ${message.text.replaceAll('\n', ' ')}`,
  );
  return { code: 0, output: lines.join('\n') } as const;
}

/** Registers `search <text> [--room <r>] [--limit <n>]`. */
export function registerSearch(program: Command) {
  program
    .command('search')
    .description('Find messages that have every word, newest first, in every room or one.')
    .argument('<text>', 'words to find')
    .option('--room <room>', 'only this room')
    .option('--limit <n>', `at most this many, ${SEARCH_LIMIT} by default`, Number)
    .action(async (text: string, options: { limit?: number; room?: string }) => {
      const result = await runSearch({ dataDir: dataDir(), fetch, q: text, url: daemonUrl(), ...options });
      if (result.code === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
