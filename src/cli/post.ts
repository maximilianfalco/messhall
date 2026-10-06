import type { Command } from 'commander';

import pc from 'picocolors';

import { daemonUrl, dataDir } from '../config.js';
import { joinPostLeave, withAgentSession } from '../mcp/oneshot.js';

import { readAgentKey } from './agentKey.js';

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

/** Joins `room` as `as`, posts, then leaves, over MCP with the agent key. Prints the message id, or one red line. */
export async function runPost({
  as,
  dataDir: dir,
  done,
  room,
  text,
  url,
}: {
  as: string;
  dataDir: string;
  done?: boolean;
  room: string;
  text: string;
  url: string;
}) {
  const session = await withAgentSession({ key: readAgentKey(dir), name: 'messhall-cli', url }, client =>
    joinPostLeave({ as, client, done, room, text }),
  );
  if (!session.ok) return fail(`messhall is down, nothing answers on ${url}. run messhall start`);
  const { id, replies } = session.value;
  if (id !== undefined) return { code: 0, output: String(id) } as const;
  return fail(`messhall refused the post: ${replies.find(reply => reply.isError)?.text ?? 'no message id came back'}`);
}

/** Registers `post <room> --as <name> <text> [--done]`. */
export function registerPost(program: Command) {
  program
    .command('post')
    .description('Post one message into a room as a named agent, then leave. For scripts.')
    .argument('<room>', 'room name')
    .argument('<text>', 'what to say')
    .requiredOption('--as <name>', 'name to post as')
    .option('--done', 'mark this post as done')
    .action(async (room: string, text: string, options: { as: string; done?: boolean }) => {
      const result = await runPost({ ...options, dataDir: dataDir(), room, text, url: daemonUrl() });
      if (result.code === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.code;
    });
}
