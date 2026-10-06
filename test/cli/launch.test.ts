import type { LaunchDeps } from '../../src/cli/launch.js';
import type { RunResult } from '../../src/lib/run.js';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { beforeEach, describe, expect, it } from 'vitest';

import { claudeArgv, claudePrompt, runClaude } from '../../src/cli/claude.js';
import { codexArgv, codexPrompt, runCodex } from '../../src/cli/codex.js';
import { packageRoot } from '../../src/lib/packageRoot.js';

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
let envs: Record<string, string>[];

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-launch-'));
  repo = path.join(home, 'checkout-api');
  mkdirSync(repo);
  logs = [];
  spawned = [];
  envs = [];
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
    spawn: (argv, cwd, env) => {
      spawned.push({ argv, cwd });
      envs.push(env);
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

  it('asks to join and then read and follow the brief when there is one', () => {
    expect(claudePrompt({ brief: '/briefs/lead.md', name: 'lead', room: 'checkout' })).toBe(
      'Join #checkout as lead with the messhall tools. Then read the brief at /briefs/lead.md and follow it in the room.',
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

  it('asks to read and follow the brief after the join when there is one', () => {
    const prompt = codexPrompt({ brief: '/briefs/lead.md', name: 'web', room: 'checkout' });

    expect(prompt).toContain('thread_id');
    expect(prompt).toContain('Then read the brief at /briefs/lead.md and follow it in the room.');
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

  it('gives each claude its own seat key in MESSHALL_SEAT and prints it on the command', async () => {
    await runClaude({ extra: [], print: false }, deps());
    await runClaude({ extra: [], print: false }, deps());

    const [first, second] = envs.map(env => env.MESSHALL_SEAT);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(output()).toContain(`MESSHALL_SEAT=${first} claude --dangerously-load-development-channels`);
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

  it('passes the --brief file as a full path from the shell cwd', async () => {
    writeFileSync(path.join(repo, 'lead.md'), 'lead the room');

    await runClaude({ as: 'lead', brief: 'lead.md', cwd: home, extra: [], print: false }, deps());

    expect(spawned[0]?.argv.at(-1)).toContain(`read the brief at ${path.join(repo, 'lead.md')} and follow it`);
  });

  it('gives the orchestrator name the shipped orchestrator brief', async () => {
    await runClaude({ as: 'orchestrator', extra: [], print: false }, deps());

    const shipped = path.join(packageRoot(), 'docs', 'briefs', 'orchestrator.md');
    expect(spawned[0]?.argv.at(-1)).toContain(`read the brief at ${shipped} and follow it`);
  });

  it('keeps an explicit --brief over the shipped one for the orchestrator name', async () => {
    writeFileSync(path.join(repo, 'mine.md'), 'my own rules');

    await runClaude({ as: 'orchestrator', brief: 'mine.md', extra: [], print: false }, deps());

    expect(spawned[0]?.argv.at(-1)).toContain(path.join(repo, 'mine.md'));
  });

  it.each([
    ['a missing file', 'nope.md'],
    ['a folder', '.'],
  ])('refuses with one line on %s as --brief, even with --print', async (_case, brief) => {
    const code = await runClaude({ brief, extra: [], print: true }, deps());

    expect(code).toBe(1);
    expect(spawned).toStrictEqual([]);
    expect(logs).toHaveLength(1);
    expect(output()).toContain(`no brief file at ${path.resolve(repo, brief)}`);
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
    expect(envs).toStrictEqual([{}]);
    expect(spawned).toStrictEqual([{ argv: codexArgv({ name: 'checkout-api', room: 'checkout' }), cwd: repo }]);
    expect(output()).toContain('codex ');
  });

  it('takes --brief like messhall claude', async () => {
    writeCodexEntry();
    writeFileSync(path.join(repo, 'lead.md'), 'lead the room');

    await runCodex({ brief: 'lead.md', print: false }, deps());

    expect(spawned[0]?.argv.at(-1)).toContain(`read the brief at ${path.join(repo, 'lead.md')} and follow it`);
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
