import { describe, expect, it } from 'vitest';

import { ClaudeNotConfiguredError } from '../../src/errors/ClaudeNotConfiguredError.js';
import { ClaudeOutputError } from '../../src/errors/ClaudeOutputError.js';
import { ClaudeTimeoutError } from '../../src/errors/ClaudeTimeoutError.js';
import { askClaude } from '../../src/lib/claude.js';

import { enoent, envelope, fakeSpawn } from './fakeSpawn.js';

const ask = { bin: '/opt/homebrew/bin/claude', prompt: 'Say pong', system: 'Be terse.', timeoutMs: 1000 };

describe('askClaude', () => {
  it('runs the resolved binary on haiku in print mode with tools, sessions, settings files and mcp off', async () => {
    const { calls, spawn } = fakeSpawn([{ code: 0, stdout: envelope() }]);

    await askClaude(ask, spawn);

    expect(calls).toStrictEqual([
      {
        args: [
          '-p',
          'Say pong',
          '--output-format',
          'json',
          '--model',
          'haiku',
          '--tools',
          '',
          '--no-session-persistence',
          '--strict-mcp-config',
          '--setting-sources',
          '',
          '--max-turns',
          '1',
          '--system-prompt',
          'Be terse.',
        ],
        command: '/opt/homebrew/bin/claude',
      },
    ]);
  });

  it('returns the text, the cost and the time from the result envelope', async () => {
    const { spawn } = fakeSpawn([{ code: 0, stdout: envelope() }]);

    await expect(askClaude(ask, spawn)).resolves.toStrictEqual({ costUsd: 0.0008, durationMs: 3690, text: 'pong' });
  });

  it('throws ClaudeOutputError with the raw stdout when the envelope is not json', async () => {
    const { spawn } = fakeSpawn([{ code: 0, stdout: 'not json at all' }]);

    const caught = await askClaude(ask, spawn).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClaudeOutputError);
    expect((caught as Error).message).toContain('not json at all');
  });

  it('throws ClaudeNotConfiguredError with the exact command when the binary is missing', async () => {
    const { spawn } = fakeSpawn([{ error: enoent() }]);

    const caught = await askClaude(ask, spawn).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClaudeNotConfiguredError);
    expect((caught as Error).message).toContain(
      "/opt/homebrew/bin/claude -p 'Say pong' --output-format json --model haiku --tools '' --no-session-persistence --strict-mcp-config --setting-sources '' --max-turns 1 --system-prompt 'Be terse.'",
    );
    expect((caught as Error).message).toContain('spawn claude ENOENT');
  });

  it('throws ClaudeNotConfiguredError with the exit code and stderr on a non-zero exit', async () => {
    const { spawn } = fakeSpawn([{ code: 1, stderr: 'Invalid API key. Please run /login' }]);

    const caught = await askClaude(ask, spawn).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClaudeNotConfiguredError);
    expect((caught as Error).message).toContain('exit code: 1');
    expect((caught as Error).message).toContain('Invalid API key. Please run /login');
  });

  it('kills the child and throws ClaudeTimeoutError once the timeout passes', async () => {
    const { children, spawn } = fakeSpawn([{ hang: true }]);

    const caught = await askClaude({ ...ask, timeoutMs: 5 }, spawn).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClaudeTimeoutError);
    expect(children[0]!.killed).toBe(true);
  });
});
