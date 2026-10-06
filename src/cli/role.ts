import type { Command } from 'commander';

import { existsSync, readFileSync } from 'node:fs';

import pc from 'picocolors';

import { feedErrorSchema, humanRoleResultSchema } from '../../contracts/feed.ts';
import { daemonUrl, dataDir } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

import { readHumanKey } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

/** Gives `member` a role in `room` as the human, with instructions as text or a file path. Prints one line. */
export async function runRole({
  dataDir: dir,
  fetch,
  instructions,
  member,
  role,
  room,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  instructions?: string;
  member: string;
  role: string;
  room: string;
  url: string;
}) {
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);
  const text = instructions && existsSync(instructions) ? readFileSync(instructions, 'utf8') : instructions;

  let response: Response;
  try {
    response = await fetch(`${url}/api/rooms/${encodeURIComponent(room)}/members/${encodeURIComponent(member)}/role`, {
      body: JSON.stringify({ instructions: text, role }),
      headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
      method: 'POST',
    });
  } catch {
    return fail(`messhall is down, nothing answers on ${url}. run messhall start`);
  }
  const body: unknown = await response.json().catch(() => {});
  const set = humanRoleResultSchema.safeParse(body);
  if (response.ok && set.success) return { code: 0, output: `${member} is now ${role} in #${room}` } as const;
  const refused = feedErrorSchema.safeParse(body);
  return fail(`messhall refused the role: ${refused.success ? refused.data.error : `http ${response.status}`}`);
}

/** Registers `role <room> <member> <role>`. */
export function registerRole(program: Command) {
  program
    .command('role')
    .description('Give a member a role in a room as the human. The member gets a line to read it.')
    .argument('<room>', 'room name')
    .argument('<member>', 'member name')
    .argument('<role>', 'worker, reviewer, orchestrator, observer or any short slug')
    .option('--instructions <file or text>', 'what the member should do in this role')
    .action(async (room: string, member: string, role: string, options: { instructions?: string }) => {
      const result = await runRole({ dataDir: dataDir(), fetch, member, role, room, url: daemonUrl(), ...options });
      if (result.code === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
