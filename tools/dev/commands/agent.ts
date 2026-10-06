import type { Client } from '@modelcontextprotocol/client';
import type { Command } from 'commander';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { callTool, joinPostLeave, withAgentSession, type ToolReply } from '../../../src/mcp/oneshot.js';
import { follow } from '../lib/follow.js';
import { bad, dim, ok } from '../lib/print.js';

const MORE = 'more are waiting';

interface AgentOptions {
  catchUp?: boolean;
  client?: string;
  follow?: boolean;
  keyFile: string;
  postFifo?: string;
  role: string;
  room: string;
  say?: string;
  signal?: AbortSignal;
  timeout?: number;
  url: string;
  wait?: boolean;
  write?: (line: string) => void;
}

function readKey(file: string) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Join, post, then wait and read once, or with `catchUp` read every page without waiting.
 * Leaves at the end, so the room reads left, not gone.
 */
async function joinAndRead(
  client: Client,
  { catchUp, role, room, say, timeout }: Pick<AgentOptions, 'catchUp' | 'role' | 'room' | 'say' | 'timeout'>,
) {
  const replies = [await callTool(client, 'join', { as: role, room })];
  const step = async (name: string, args: Record<string, unknown>) => {
    const reply = await callTool(client, name, args);
    replies.push(reply);
    return !reply.isError;
  };
  if (replies[0]!.isError) return replies;
  if (say) await step('post', { room, text: say });
  const readAll = async (): Promise<unknown> =>
    (await step('read_since', { room })) && replies.at(-1)!.text.includes(MORE) && readAll();
  if (catchUp) await readAll();
  else if (await step('wait', { room, timeout_s: timeout })) await step('read_since', { room });
  await step('leave', { room });
  return replies;
}

/** Joins once, follows until `signal` aborts, then leaves. */
async function joinAndFollow(
  client: Client,
  {
    postFifo,
    role,
    room,
    signal,
    write,
  }: Required<Pick<AgentOptions, 'role' | 'room' | 'signal' | 'write'>> & Pick<AgentOptions, 'postFifo'>,
) {
  const joined = await callTool(client, 'join', { as: role, room });
  if (joined.isError) return [joined];
  const refused = await follow({ client, postFifo, room, signal, write });
  const left = await callTool(client, 'leave', { room });
  return refused ? [joined, { isError: true, name: 'follow', seconds: 0, text: refused }, left] : [joined, left];
}

/**
 * A scripted agent over real HTTP MCP: joins `room` as `role`, posts `say`, and always leaves before the
 * session ends. `wait` blocks once, `catchUp` reads the backlog, `follow` holds the seat until `signal` aborts.
 */
export async function agentRun({
  catchUp,
  client,
  follow: following,
  keyFile,
  postFifo,
  role,
  room,
  say,
  signal = new AbortController().signal,
  timeout,
  url,
  wait,
  write = line => process.stdout.write(line),
}: AgentOptions) {
  const key = readKey(keyFile);
  if (!key) return { code: 1, report: bad(`no agent key at ${keyFile}. start the daemon once to make it`) };

  const session = await withAgentSession({ key, name: client ?? 'messhall-dev', url }, mcp =>
    following
      ? joinAndFollow(mcp, { postFifo, role, room, signal, write })
      : wait || catchUp
        ? joinAndRead(mcp, { catchUp, role, room, say, timeout })
        : joinPostLeave({ as: role, client: mcp, room, text: say }).then(result => result.replies),
  );
  if (!session.ok) {
    return {
      code: 1,
      report: bad(
        `could not reach messhall at ${url} (${errorText(session.error)}). run pnpm messhall-dev daemon --keep`,
      ),
    };
  }
  const label = ({ name, seconds }: ToolReply) =>
    name === 'join'
      ? `${role} join #${room}`
      : name === 'wait'
        ? `${role} wait, blocked ${seconds.toFixed(1)} s`
        : `${role} ${name}`;
  const lines = session.value.flatMap(reply => [reply.isError ? bad(label(reply)) : ok(label(reply)), reply.text, '']);
  const left = session.value.some(reply => reply.name === 'leave' && !reply.isError);
  lines.push(dim(left ? `session ended, ${role} left #${room}` : `session ended, ${role} is gone from #${room}`));
  return { code: session.value.some(reply => reply.isError) ? 1 : 0, report: lines.join('\n') };
}

/** Registers `agent <role> --room <r> [--say <text>] [--wait] [--catch-up] [--follow [--post-fifo <path>]] [--client <name>] [--url <u>] [--key-file <f>]`. */
export function registerAgent(program: Command) {
  program
    .command('agent <role>')
    .description('A scripted agent over real HTTP MCP: join, post, wait, read, with how long wait blocked.')
    .requiredOption('--room <room>', 'room to join')
    .option('--say <text>', 'post this after joining')
    .option('--wait', 'block until something concerns this agent, then read')
    .option('--catch-up', 'read the backlog and leave without waiting')
    .option('--follow', 'hold the seat: print each new message line, leave on SIGINT or SIGTERM')
    .option('--post-fifo <path>', 'with --follow, post each line written to this named pipe (made if missing)')
    .option('--timeout <s>', 'wait timeout in seconds', value => Number(value))
    .option('--client <name>', 'clientInfo name to send at initialize, to act as another agent')
    .option('--url <url>', 'daemon url', daemonUrl())
    .option('--key-file <file>', 'agent key file', path.join(dataDir(), KEY_FILES.agent))
    .action(async (role: string, options: Omit<AgentOptions, 'role'>) => {
      const stop = new AbortController();
      const onSignal = () => stop.abort();
      process.once('SIGINT', onSignal).once('SIGTERM', onSignal);
      const result = await agentRun({ ...options, role, signal: stop.signal });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
