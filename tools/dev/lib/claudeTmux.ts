import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { KEY_HEADER } from '../../../src/daemon/keys.js';
import { dialogKeys, until } from '../../../src/flock/tmux.js';
import { shellLine } from '../../../src/lib/shell.js';
import { SEAT_HEADER, SERVER_NAME } from '../../../src/mcp/constants.js';

import { run } from './run.js';

export const READY_WITHIN_MS = 60_000;
const REGISTERED = `MCP server "${SERVER_NAME}": Channel notifications registered`;

export type Launch = 'login' | 'registered' | 'timeout';

interface McpTarget {
  key: string;
  seat?: string;
  url: string;
}

/** The `--mcp-config` json that points Claude Code at the daemon with the agent key header, and the seat key when given. */
export function mcpConfigJson({ key, seat, url }: McpTarget) {
  const headers = { [KEY_HEADER]: key, ...(seat ? { [SEAT_HEADER]: seat } : {}) };
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { headers, type: 'http', url: `${url}/mcp` } } });
}

/** The seat key header in an mcp config `file` written before, if there is one. */
export function seatKeyIn(file: string): string | undefined {
  if (!existsSync(file)) return;
  try {
    const seat: unknown = JSON.parse(readFileSync(file, 'utf8')).mcpServers?.[SERVER_NAME]?.headers?.[SEAT_HEADER];
    return typeof seat === 'string' ? seat : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the mcp config to `file` with mode 0600, since it holds the agent key. */
export function writeMcpConfig({ file, ...target }: McpTarget & { file: string }) {
  writeFileSync(file, mcpConfigJson(target));
  chmodSync(file, 0o600);
}

/** The interactive `claude` argv: only messhall from `mcpConfig`, loaded as a dev channel, debug log to `debugFile`. */
export function claudeArgv({
  allowedTools,
  debugFile,
  mcpConfig,
}: {
  allowedTools: string[];
  debugFile: string;
  mcpConfig: string;
}) {
  return [
    'claude',
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    '--dangerously-load-development-channels',
    `server:${SERVER_NAME}`,
    '--allowedTools',
    ...allowedTools,
    '--debug-file',
    debugFile,
  ];
}

export const tmux = (args: string[]) => run('tmux', args, tmpdir());
export const pane = async (session: string) => (await tmux(['capture-pane', '-p', '-t', session])).stdout;
export const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** Starts `argv` in tmux in `cwd`, answers the trust and dev channel dialogs, waits for the channel to register. */
export async function launchClaude({
  argv,
  cwd,
  debugFile,
  note,
  session,
}: {
  argv: string[];
  cwd: string;
  debugFile: string;
  note: (line: string) => void;
  session: string;
}): Promise<Launch> {
  await tmux(['kill-session', '-t', session]);
  const started = await tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50', '-c', cwd, shellLine(argv)]);
  if (started.code !== 0) throw new Error(`tmux new-session failed: ${started.stderr.trim()}`);
  note(`claude started in tmux session ${session}`);

  const ready = await until<Launch>(Date.now() + READY_WITHIN_MS, async () => {
    const dialog = dialogKeys(await pane(session));
    if (dialog.kind === 'login') return 'login';
    if (dialog.kind === 'none') return readText(debugFile).includes(REGISTERED) ? 'registered' : undefined;
    note(`answering a dialog with ${dialog.keys.join(' ')}`);
    await tmux(['send-keys', '-t', session, ...dialog.keys]);
    await sleep(1000);
  });
  return ready ?? 'timeout';
}
