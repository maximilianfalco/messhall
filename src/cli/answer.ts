import type { Command } from 'commander';

import pc from 'picocolors';

import { answerResultSchema, feedErrorSchema } from '../../contracts/feed.ts';
import { daemonUrl, dataDir } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

import { readHumanKey } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

// Digits and commas are picks, anything else is the human's own words.
const PICKS = /^[\d,\s]+$/;

const toAnswer = (pick: string) => {
  if (!PICKS.test(pick)) return { other: pick, picks: [] };
  const numbers = pick.split(',').map(part => Number(part.trim()));
  return numbers.every(number => Number.isInteger(number) && number >= 1)
    ? { picks: numbers.map(number => number - 1) }
    : undefined;
};

/** Answers an agent's question as the human, one pick per question: a button number from 1 as watch shows them,
 * numbers with commas on a pick any question, or words of the human's own. Prints the answer line. */
export async function runAnswer({
  dataDir: dir,
  fetch,
  id,
  picks,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  id: string;
  picks: string[];
  url: string;
}) {
  const answers = picks.map(toAnswer);
  const bad = picks.find((_pick, index) => !answers[index]);
  if (bad !== undefined) return fail(`a pick is a number from 1, not ${bad}`);
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);

  let response: Response;
  try {
    response = await fetch(`${url}/api/questions/${encodeURIComponent(id)}`, {
      body: JSON.stringify({ answers }),
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

/** Registers `answer <id> <picks...>`. */
export function registerAnswer(program: Command) {
  program
    .command('answer')
    .description("Answer an agent's question as the human: one pick per question, by number or in your own words.")
    .argument('<id>', 'question id, as watch shows it')
    .argument(
      '<picks...>',
      'per question: a button number from 1, numbers like 1,3 on a pick any one, or your own words',
    )
    .action(async (id: string, picks: string[]) => {
      const result = await runAnswer({ dataDir: dataDir(), fetch, id, picks, url: daemonUrl() });
      if (result.code === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
