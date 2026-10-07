import type { Command } from 'commander';

import pc from 'picocolors';

import { answerResultSchema, feedErrorSchema } from '../../contracts/feed.ts';
import { daemonUrl, dataDir } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

import { readHumanKey } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

/** Picks button `option` (from 1, as watch shows them) on an agent's question as the human. Prints the answer line. */
export async function runAnswer({
  dataDir: dir,
  fetch,
  id,
  option,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  id: string;
  option: string;
  url: string;
}) {
  const number = Number(option);
  if (!Number.isInteger(number) || number < 1) return fail(`option is a button number from 1, not ${option}`);
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);

  let response: Response;
  try {
    response = await fetch(`${url}/api/questions/${encodeURIComponent(id)}`, {
      body: JSON.stringify({ option: number - 1 }),
      headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
      method: 'POST',
    });
  } catch {
    return fail(`messhall is down, nothing answers on ${url}. run messhall start`);
  }
  const body: unknown = await response.json().catch(() => {});
  const answered = answerResultSchema.safeParse(body);
  if (response.ok && answered.success) {
    const { id: messageId, text } = answered.data.message;
    return { code: 0, output: `#${messageId} ${text}` } as const;
  }
  const refused = feedErrorSchema.safeParse(body);
  return fail(`messhall refused the answer: ${refused.success ? refused.data.error : `http ${response.status}`}`);
}

/** Registers `answer <id> <option>`. */
export function registerAnswer(program: Command) {
  program
    .command('answer')
    .description("Answer an agent's question as the human: pick a button by its number.")
    .argument('<id>', 'question id, as watch shows it')
    .argument('<option>', 'button number, from 1')
    .action(async (id: string, option: string) => {
      const result = await runAnswer({ dataDir: dataDir(), fetch, id, option, url: daemonUrl() });
      if (result.code === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
