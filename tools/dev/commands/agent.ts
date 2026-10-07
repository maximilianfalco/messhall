import type { Client } from '@modelcontextprotocol/client';
import type { Command } from 'commander';

import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';

import { daemonUrl, dataDir } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import {
  callTool,
  joinPostLeave,
  openAgentSession,
  withAgentSession,
  type AgentSession,
  type ToolReply,
} from '../../../src/mcp/oneshot.js';
import { PERMISSION_METHOD, PERMISSION_REQUEST_METHOD } from '../../../src/mcp/permission.js';
import { follow } from '../lib/follow.js';
import { bad, dim, ok } from '../lib/print.js';

const MORE = 'more are waiting';
// Claude Code's own request id alphabet: lowercase, no l.
const ASK_LETTERS = 'abcdefghijkmnopqrstuvwxyz';
const ASK_TIMEOUT_S = 120;
const verdictSchema = z.object({ behavior: z.string(), request_id: z.string() });

interface AgentOptions {
  ask?: string;
  assign?: string;
  catchUp?: boolean;
  client?: string;
  follow?: boolean;
  instructions?: string;
  keyFile: string;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
  postFifo?: string;
  role: string;
  room: string;
  say?: string;
  seat?: string;
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
 * Leaves at the end, so the room reads left, not away.
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

/** Joins, asks to run `command` the way Claude Code relays a permission dialog, waits for the verdict, then leaves. */
async function joinAndAsk(
  client: Client,
  { command, role, room, timeout = ASK_TIMEOUT_S }: { command: string; role: string; room: string; timeout?: number },
) {
  const joined = await callTool(client, 'join', { as: role, room });
  if (joined.isError) return [joined];
  const requestId = Array.from({ length: 5 }, () => ASK_LETTERS[randomInt(ASK_LETTERS.length)]).join('');
  const verdict = new Promise<string>(resolve => {
    client.setNotificationHandler(PERMISSION_METHOD, { params: verdictSchema }, params => {
      if (params.request_id === requestId) resolve(params.behavior);
    });
  });
  const started = performance.now();
  await client.notification({
    method: PERMISSION_REQUEST_METHOD,
    params: {
      description: `Run ${command}`,
      input_preview: `{ "command": ${JSON.stringify(command)} }`,
      request_id: requestId,
      tool_name: 'Bash',
    },
  });
  const timer = new AbortController();
  const behavior = await Promise.race([verdict, sleep(timeout * 1000, '', { signal: timer.signal }).catch(() => '')]);
  // A live timer would hold the process open for the whole timeout.
  timer.abort();
  const asked: ToolReply = {
    isError: !behavior,
    name: 'ask',
    seconds: (performance.now() - started) / 1000,
    text: behavior ? `verdict ${behavior}` : `no verdict in ${timeout} s`,
  };
  return [joined, asked, await callTool(client, 'leave', { room })];
}

/** Joins, posts `say` if given, sets `member`'s role, then leaves even after a refusal. */
async function joinAssignLeave(
  client: Client,
  {
    instructions,
    member,
    role,
    room,
    say,
    value,
  }: { instructions?: string; member: string; role: string; room: string; say?: string; value: string },
) {
  const joined = await callTool(client, 'join', { as: role, room });
  if (joined.isError) return [joined];
  const posted = say ? [await callTool(client, 'post', { room, text: say })] : [];
  const assigned = await callTool(client, 'assign_role', { instructions, member, role: value, room });
  return [joined, ...posted, assigned, await callTool(client, 'leave', { room })];
}

/** Joins once, follows until `signal` aborts, then leaves. A lost session is reopened and joined
 * again under the same name, so the seat outlives a daemon restart. */
async function joinAndFollow(
  client: Client,
  {
    open,
    pause,
    postFifo,
    role,
    room,
    signal,
    write,
  }: Required<Pick<AgentOptions, 'role' | 'room' | 'signal' | 'write'>> &
    Pick<AgentOptions, 'pause' | 'postFifo'> & { open: () => Promise<AgentSession> },
) {
  const joined = await callTool(client, 'join', { as: role, room });
  if (joined.isError) return [joined];
  let current: AgentSession | undefined;
  const rejoin = async () => {
    await current?.close();
    current = await open();
    const again = await callTool(current.client, 'join', { as: role, room });
    if (again.isError) throw new Error(again.text);
    return current.client;
  };
  try {
    const followed = await follow({ client, pause, postFifo, rejoin, room, signal, write });
    const left = await callTool(followed.client, 'leave', { room }).catch((error: unknown): ToolReply => ({
      isError: true,
      name: 'leave',
      seconds: 0,
      text: errorText(error),
    }));
    return followed.refused
      ? [joined, { isError: true, name: 'follow', seconds: 0, text: followed.refused }, left]
      : [joined, left];
  } finally {
    await current?.close();
  }
}

/**
 * A scripted agent over real HTTP MCP: joins `room` as `role`, posts `say`, and always leaves before the
 * session ends. `ask` waits up to `timeout` (120 s) for the human's verdict, `wait` blocks once, `catchUp` reads the backlog, `follow` holds the seat until `signal` aborts.
 */
export async function agentRun({
  ask,
  assign,
  instructions: instructionsFile,
  catchUp,
  client,
  follow: following,
  keyFile,
  pause,
  postFifo,
  role,
  room,
  say,
  seat,
  signal = new AbortController().signal,
  timeout,
  url,
  wait,
  write = line => process.stdout.write(line),
}: AgentOptions) {
  const [member, value] = assign?.split('=') ?? [];
  if (assign !== undefined && !(member && value)) return { code: 1, report: bad('--assign takes <member>=<role>') };
  if (instructionsFile && !assign) return { code: 1, report: bad('--instructions goes with --assign') };
  if (instructionsFile && !existsSync(instructionsFile)) {
    return { code: 1, report: bad(`no instructions file at ${instructionsFile}`) };
  }
  const instructions = instructionsFile ? readFileSync(instructionsFile, 'utf8').trim() : undefined;
  const key = readKey(keyFile);
  if (!key) return { code: 1, report: bad(`no agent key at ${keyFile}. start the daemon once to make it`) };

  const target = { key, name: client ?? 'messhall-dev', seat, url };
  const session = await withAgentSession(target, mcp =>
    following
      ? joinAndFollow(mcp, { open: () => openAgentSession(target), pause, postFifo, role, room, signal, write })
      : ask
        ? joinAndAsk(mcp, { command: ask, role, room, timeout })
        : member && value
          ? joinAssignLeave(mcp, { instructions, member, role, room, say, value })
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
        : name === 'ask'
          ? `${role} ask Bash: ${ask}`
          : `${role} ${name}`;
  const lines = session.value.flatMap(reply => [reply.isError ? bad(label(reply)) : ok(label(reply)), reply.text, '']);
  const left = session.value.some(reply => reply.name === 'leave' && !reply.isError);
  lines.push(dim(left ? `session ended, ${role} left #${room}` : `session ended, ${role} is away from #${room}`));
  return { code: session.value.some(reply => reply.isError) ? 1 : 0, report: lines.join('\n') };
}

/** Registers `agent <role> --room <r> [--say <text>] [--ask <command>] [--assign <member=role> [--instructions <file>]] [--wait] [--catch-up] [--follow [--post-fifo <path>]] [--client <name>] [--seat <key>] [--url <u>] [--key-file <f>]`. */
export function registerAgent(program: Command) {
  program
    .command('agent <role>')
    .description('A scripted agent over real HTTP MCP: join, post, wait, read, with how long wait blocked.')
    .requiredOption('--room <room>', 'room to join')
    .option('--say <text>', 'post this after joining')
    .option('--ask <command>', 'ask to run this Bash command as Claude Code does, print the verdict, then leave')
    .option('--assign <member=role>', "set a member's role after the post, as the orchestrator does")
    .option('--instructions <file>', 'with --assign, send this file as the role instructions')
    .option('--wait', 'block until something concerns this agent, then read')
    .option('--catch-up', 'read the backlog and leave without waiting')
    .option(
      '--follow',
      'hold the seat: print each new message line, rejoin after a daemon restart, leave on SIGINT or SIGTERM',
    )
    .option('--post-fifo <path>', 'with --follow, post each line written to this named pipe (made if missing)')
    .option('--timeout <s>', 'wait timeout in seconds', value => Number(value))
    .option('--client <name>', 'clientInfo name to send at initialize, to act as another agent')
    .option('--seat <key>', 'seat key header to send, as messhall claude does, so the seat comes back after a drop')
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
