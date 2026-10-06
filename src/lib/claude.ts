import { spawn } from 'node:child_process';

import { z } from 'zod';

import { ClaudeNotConfiguredError } from '../errors/ClaudeNotConfiguredError.js';
import { ClaudeOutputError } from '../errors/ClaudeOutputError.js';
import { ClaudeTimeoutError } from '../errors/ClaudeTimeoutError.js';

export const CLAUDE_MODEL = 'haiku';

export interface AskOptions {
  prompt: string;
  system: string;
  timeoutMs: number;
}

export interface ClaudeReply {
  costUsd: number;
  durationMs: number;
  text: string;
}

export type Ask = (options: AskOptions) => Promise<ClaudeReply>;

interface ClaudeStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

export interface ClaudeProcess {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  stderr: ClaudeStream | null;
  stdout: ClaudeStream | null;
}

export type ClaudeSpawn = (command: string, args: string[]) => ClaudeProcess;

const envelopeSchema = z.object({
  duration_ms: z.number(),
  result: z.string().default(''),
  total_cost_usd: z.number(),
});

const defaultSpawn: ClaudeSpawn = (command, args) => spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", String.raw`'\''`)}'`);
const commandLine = (bin: string, args: string[]) => [bin, ...args].map(quote).join(' ');

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Asks claude on haiku through `claude -p`: tools off, no session saved, no settings files and no
 * MCP, so a repo's CLAUDE.md never gets in. `bin` is the resolved path, since launchd has a bare PATH.
 */
export function askClaude(
  { bin, prompt, system, timeoutMs }: AskOptions & { bin: string },
  spawnClaude: ClaudeSpawn = defaultSpawn,
): Promise<ClaudeReply> {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--model',
    CLAUDE_MODEL,
    '--tools',
    '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--max-turns',
    '1',
    '--system-prompt',
    system,
  ];
  const command = commandLine(bin, args);
  return new Promise((resolve, reject) => {
    const child = spawnClaude(bin, args);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(new ClaudeNotConfiguredError({ command, exitCode: null, stderr: error.message, stdout }));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new ClaudeTimeoutError({ command, timeoutMs }));
      if (code !== 0) return reject(new ClaudeNotConfiguredError({ command, exitCode: code, stderr, stdout }));
      const parsed = envelopeSchema.safeParse(safeJson(stdout));
      if (!parsed.success) return reject(new ClaudeOutputError({ issue: z.prettifyError(parsed.error), raw: stdout }));
      resolve({ costUsd: parsed.data.total_cost_usd, durationMs: parsed.data.duration_ms, text: parsed.data.result });
    });
  });
}
