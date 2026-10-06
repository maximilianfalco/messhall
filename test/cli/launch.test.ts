import type { LaunchDeps } from '../../src/cli/launch.js';
import type { RunResult } from '../../src/lib/run.js';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { beforeEach, describe, expect, it } from 'vitest';

import { claudeArgv, claudePrompt, runClaude } from '../../src/cli/claude.js';
import { codexArgv, codexPrompt, runCodex } from '../../src/cli/codex.js';

const URL_BASE = 'http://127.0.0.1:7787';
const CLAUDE_ENTRY = [
  'messhall:',
  '  Status: ✔ Connected',
  `  URL: ${URL_BASE}/mcp`,
  `  X-Messhall-Key: ${'a1'.repeat(32)}`,
].join('\n');

const healthy = () =>
  Promise.resolve(Response.json({ live_members: 0, ok: true, rooms: 0, uptime_s: 5, version: '0.1.0' }));
const refused = () => Promise.reject(new TypeError('fetch failed'));
const answer =
  (result: RunResult): LaunchDeps['run'] =>
  () =>
    Promise.resolve(result);
const FOUND = answer({ code: 0, stderr: '', stdout: CLAUDE_ENTRY });
const NOT_FOUND = answer({ code: 1, stderr: 'No MCP server named "messhall".', stdout: '' });

let home: string;
let repo: string;
let logs: string[];
let spawned: { argv: string[]; cwd: string }[];

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-launch-'));
  repo = path.join(home, 'checkout-api');
  mkdirSync(repo);
  logs = [];
  spawned = [];
});

const output = () => stripVTControlCharacters(logs.join('\n'));

function writeCodexEntry() {
  mkdirSync(path.join(home, '.codex'));
  writeFileSync(path.join(home, '.codex', 'config.toml'), `[mcp_servers.messhall]\nurl = "${URL_BASE}/mcp"\n`);
}

function deps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    codexConfig: path.join(home, '.codex', 'config.toml'),
    cwd: repo,
    fetch: healthy,
    log: line => logs.push(line),
    run: FOUND,
    spawn: (argv, cwd) => {
      spawned.push({ argv, cwd });
      return Promise.resolve(3);
    },
    url: URL_BASE,
    ...overrides,
  };
}

describe('claudeArgv', () => {
  it('loads messhall as a dev channel, keeps extra args and puts the prompt after --', () => {
    expect(claudeArgv({ extra: ['--model', 'opus'], name: 'api', room: 'checkout' })).toStrictEqual([
      'claude',
      '--dangerously-load-development-channels',
      'server:messhall',
      '--model',
      'opus',
      '--',
      claudePrompt({ name: 'api', room: 'checkout' }),
    ]);
  });

  it('asks to join the room under the name and then wait for instructions', () => {
    expect(claudePrompt({ name: 'api', room: 'checkout' })).toBe(
      'Join #checkout as api with the messhall tools, then wait for instructions from the room or the human.',
    );
  });
});

describe('codexArgv', () => {
  it('is codex and the prompt alone, so codex stays on the shared daemon', () => {
    expect(codexArgv({ name: 'web', room: 'checkout' })).toStrictEqual([
      'codex',
      codexPrompt({ name: 'web', room: 'checkout' }),
    ]);
  });

  it('asks to join with thread_id set to CODEX_THREAD_ID', () => {
    const prompt = codexPrompt({ name: 'web', room: 'checkout' });

    expect(prompt).toContain('$CODEX_THREAD_ID');
    expect(prompt).toContain('thread_id');
    expect(prompt).toContain('#checkout as web');
  });
});

describe('runClaude', () => {
  it('prints the command, then runs it in the cwd with the folder name and the lobby room', async () => {
    const code = await runClaude({ extra: [], print: false }, deps());

    const argv = claudeArgv({ extra: [], name: 'checkout-api', room: 'lobby' });
    expect(code).toBe(3);
    expect(spawned).toStrictEqual([{ argv, cwd: repo }]);
    expect(output()).toContain('claude --dangerously-load-development-channels server:messhall -- ');
  });

  it('takes --room, --as and --cwd', async () => {
    const other = path.join(home, 'web');
    mkdirSync(other);

    await runClaude({ as: 'reviewer', cwd: other, extra: [], print: false, room: 'checkout' }, deps());

    expect(spawned).toStrictEqual([
      { argv: claudeArgv({ extra: [], name: 'reviewer', room: 'checkout' }), cwd: other },
    ]);
  });

  it('names the agent after the --cwd folder when --as is left out', async () => {
    const other = path.join(home, 'web');
    mkdirSync(other);

    await runClaude({ cwd: other, extra: [], print: false }, deps());

    expect(spawned[0]?.argv.at(-1)).toContain('as web ');
  });

  it('only prints the command and the prompt with --print', async () => {
    const code = await runClaude({ extra: [], print: true }, deps({ fetch: refused, run: NOT_FOUND }));

    expect(code).toBe(0);
    expect(spawned).toStrictEqual([]);
    expect(output()).toContain('Join #lobby as checkout-api');
  });

  it('refuses with one line when the daemon is down', async () => {
    const code = await runClaude({ extra: [], print: false }, deps({ fetch: refused }));

    expect(code).toBe(1);
    expect(spawned).toStrictEqual([]);
    expect(logs).toHaveLength(1);
    expect(output()).toContain('run messhall start');
  });

  it('refuses with one line when claude code has no messhall entry', async () => {
    const code = await runClaude({ extra: [], print: false }, deps({ run: NOT_FOUND }));

    expect(code).toBe(1);
    expect(spawned).toStrictEqual([]);
    expect(logs).toHaveLength(1);
    expect(output()).toContain('run messhall mcp install');
  });
});

describe('runCodex', () => {
  it('prints the command, then runs it in the cwd with the folder name', async () => {
    writeCodexEntry();

    const code = await runCodex({ print: false, room: 'checkout' }, deps());

    expect(code).toBe(3);
    expect(spawned).toStrictEqual([{ argv: codexArgv({ name: 'checkout-api', room: 'checkout' }), cwd: repo }]);
    expect(output()).toContain('codex ');
  });

  it('only prints the command and the prompt with --print', async () => {
    const code = await runCodex({ print: true }, deps({ fetch: refused }));

    expect(code).toBe(0);
    expect(spawned).toStrictEqual([]);
    expect(output()).toContain('$CODEX_THREAD_ID');
  });

  it('refuses with one line when the daemon is down', async () => {
    writeCodexEntry();

    const code = await runCodex({ print: false }, deps({ fetch: refused }));

    expect(code).toBe(1);
    expect(spawned).toStrictEqual([]);
    expect(logs).toHaveLength(1);
    expect(output()).toContain('run messhall start');
  });

  it('refuses with one line when the codex config has no messhall block', async () => {
    const code = await runCodex({ print: false }, deps());

    expect(code).toBe(1);
    expect(spawned).toStrictEqual([]);
    expect(logs).toHaveLength(1);
    expect(output()).toContain('run messhall mcp install');
  });
});
