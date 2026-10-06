import type { Client } from '@modelcontextprotocol/client';
import type { Command } from 'commander';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { callTool, joinPostLeave, withAgentSession, type ToolReply } from '../../../src/mcp/oneshot.js';
import { bad, dim, ok } from '../lib/print.js';

interface AgentOptions {
  client?: string;
  keyFile: string;
  role: string;
  room: string;
  say?: string;
  timeout?: number;
  url: string;
  wait?: boolean;
}

function readKey(file: string) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Join, post, wait, then read_since. Stays in the room, so the member turns gone when the session ends. */
async function joinAndWait(
  client: Client,
  { role, room, say, timeout }: Omit<AgentOptions, 'client' | 'keyFile' | 'url'>,
) {
  const replies = [await callTool(client, 'join', { as: role, room })];
  const step = async (name: string, args: Record<string, unknown>) => {
    const reply = await callTool(client, name, args);
    replies.push(reply);
    return !reply.isError;
  };
  if (replies[0]!.isError) return replies;
  if (say) await step('post', { room, text: say });
  if (await step('wait', { room, timeout_s: timeout })) await step('read_since', { room });
  return replies;
}

/**
 * A scripted agent over real HTTP MCP: joins `room` as `role` and posts `say`. Without `wait` it
 * leaves before the session ends. With `wait` it blocks until something concerns it, reads, and ends gone.
 */
export async function agentRun({ client, keyFile, role, room, say, timeout, url, wait }: AgentOptions) {
  const key = readKey(keyFile);
  if (!key) return { code: 1, report: bad(`no agent key at ${keyFile}. start the daemon once to make it`) };

  const session = await withAgentSession({ key, name: client ?? `messhall-dev-agent-${role}`, url }, mcp =>
    wait
      ? joinAndWait(mcp, { role, room, say, timeout })
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

/** Registers `agent <role> --room <r> [--say <text>] [--wait] [--client <name>] [--url <u>] [--key-file <f>]`. */
export function registerAgent(program: Command) {
  program
    .command('agent <role>')
    .description('A scripted agent over real HTTP MCP: join, post, wait, read, with how long wait blocked.')
    .requiredOption('--room <room>', 'room to join')
    .option('--say <text>', 'post this after joining')
    .option('--wait', 'block until something concerns this agent, then read')
    .option('--timeout <s>', 'wait timeout in seconds', value => Number(value))
    .option('--client <name>', 'clientInfo name to send at initialize, to act as another agent')
    .option('--url <url>', 'daemon url', daemonUrl())
    .option('--key-file <file>', 'agent key file', path.join(dataDir(), KEY_FILES.agent))
    .action(async (role: string, options: Omit<AgentOptions, 'role'>) => {
      const result = await agentRun({ ...options, role });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
