import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { KEY_HEADER } from '../../../src/daemon/keys.js';
import { shellLine } from '../../../src/lib/shell.js';
import { SERVER_NAME } from '../../../src/mcp/constants.js';

import { run } from './run.js';

export const READY_WITHIN_MS = 60_000;
const POLL_MS = 500;
const REGISTERED = `MCP server "${SERVER_NAME}": Channel notifications registered`;

type Dialog = { keys: string[]; kind: 'answer' } | { kind: 'login' } | { kind: 'none' };
export type Launch = 'login' | 'registered' | 'timeout';

const DIALOG_TARGETS = [/I am using this for local development/i, /Yes, I trust this folder/i, /Yes, proceed/i];
const LOGIN = /Select login method|Please run \/login|Invalid API key|OAuth error/i;
const SELECTED = '❯';

/** What to press on the pane: arrows from the `❯` line to the safe option of a known dialog, or stop on a login screen. */
export function dialogKeys(pane: string): Dialog {
  if (LOGIN.test(pane)) return { kind: 'login' };
  const lines = pane.split('\n');
  const target = lines.findLastIndex(line => DIALOG_TARGETS.some(pattern => pattern.test(line)));
  const current = lines.findIndex(line => line.trimStart().startsWith(SELECTED));
  if (target < 0 || current < 0) return { kind: 'none' };
  const moves = target - current;
  return {
    keys: [...Array.from({ length: Math.abs(moves) }, () => (moves > 0 ? 'Down' : 'Up')), 'Enter'],
    kind: 'answer',
  };
}

/** The `--mcp-config` json that points Claude Code at the daemon with the agent key header. */
export function mcpConfigJson({ key, url }: { key: string; url: string }) {
  return JSON.stringify({
    mcpServers: { [SERVER_NAME]: { headers: { [KEY_HEADER]: key }, type: 'http', url: `${url}/mcp` } },
  });
}

/** Writes the mcp config to `file` with mode 0600, since it holds the agent key. */
export function writeMcpConfig({ file, key, url }: { file: string; key: string; url: string }) {
  writeFileSync(file, mcpConfigJson({ key, url }));
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

/** Polls `check` until it gives a value or `deadline` passes. */
export async function until<T>(
  deadline: number,
  check: () => Promise<T | undefined> | T | undefined,
): Promise<T | undefined> {
  const value = await check();
  if (value !== undefined || Date.now() > deadline) return value;
  await sleep(POLL_MS);
  return until(deadline, check);
}

/** Types `text` into the session and presses Enter. */
export async function typePrompt(session: string, text: string) {
  await tmux(['send-keys', '-t', session, '-l', text]);
  await tmux(['send-keys', '-t', session, 'Enter']);
}

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
