import type { Command } from 'commander';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { connectHttp } from '../../../src/mcp/testing.js';
import { bad, dim, ok } from '../lib/print.js';

interface AgentOptions {
  done?: boolean;
  keyFile: string;
  role: string;
  room: string;
  say?: string;
  timeout?: number;
  url: string;
  wait?: boolean;
}

type Connected = Awaited<ReturnType<typeof connectHttp>>;

function readKey(file: string) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A scripted agent over real HTTP MCP: joins `room` as `role`, posts `say` (as done with `done`), and
 * with `wait` blocks until something concerns it, then reads. Ends its session with DELETE, so the member turns gone.
 */
export async function agentRun({ done, keyFile, role, room, say, timeout, url, wait }: AgentOptions) {
  const key = readKey(keyFile);
  if (!key) return { code: 1, report: bad(`no agent key at ${keyFile}. start the daemon once to make it`) };

  let connected: Connected;
  try {
    connected = await connectHttp({ key, name: `messhall-dev-agent-${role}`, url });
  } catch (error) {
    return {
      code: 1,
      report: bad(`could not reach messhall at ${url} (${errorText(error)}). run pnpm messhall-dev daemon --keep`),
    };
  }
  const { client, transport } = connected;
  const lines: string[] = [];
  let failed = false;
  const call = async (label: string, name: string, args: Record<string, unknown>) => {
    const started = performance.now();
    const result = await client.callTool({ arguments: args, name }, { resetTimeoutOnProgress: true, timeout: 300_000 });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
    failed ||= Boolean(result.isError);
    lines.push(result.isError ? bad(label) : ok(name === 'wait' ? `${label}, blocked ${seconds} s` : label), text, '');
    return !result.isError;
  };

  try {
    const joined = await call(`${role} join #${room}`, 'join', { as: role, room });
    if (joined && say) await call(`${role} post`, 'post', { done, room, text: say });
    if (joined && wait && (await call(`${role} wait`, 'wait', { room, timeout_s: timeout }))) {
      await call(`${role} read_since`, 'read_since', { room });
    }
  } finally {
    await transport.terminateSession().catch(() => {});
    await client.close();
  }
  lines.push(dim(`session ended, ${role} is gone from #${room}`));
  return { code: failed ? 1 : 0, report: lines.join('\n') };
}

/** Registers `agent <role> --room <r> [--say <text>] [--done] [--wait] [--url <u>] [--key-file <f>]`. */
export function registerAgent(program: Command) {
  program
    .command('agent <role>')
    .description('A scripted agent over real HTTP MCP: join, post, wait, read, with how long wait blocked.')
    .requiredOption('--room <room>', 'room to join')
    .option('--say <text>', 'post this after joining')
    .option('--done', 'post --say as done')
    .option('--wait', 'block until something concerns this agent, then read')
    .option('--timeout <s>', 'wait timeout in seconds', value => Number(value))
    .option('--url <url>', 'daemon url', daemonUrl())
    .option('--key-file <file>', 'agent key file', path.join(dataDir(), KEY_FILES.agent))
    .action(async (role: string, options: Omit<AgentOptions, 'role'>) => {
      const result = await agentRun({ ...options, role });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
