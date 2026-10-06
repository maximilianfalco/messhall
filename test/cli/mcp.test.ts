import type { McpDeps } from '../../src/cli/mcp.js';
import type { RunResult } from '../../src/lib/run.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAgentKey } from '../../src/cli/agentKey.js';
import {
  claudeLine,
  codexBlock,
  codexTuis,
  geminiEntry,
  hasChannels,
  runMcpDoctor,
  runMcpInstall,
  runMcpUninstall,
} from '../../src/cli/mcp.js';
import { codexConfigPath, geminiSettingsPath } from '../../src/config.js';
import { KEY_HEADER } from '../../src/daemon/keys.js';
import { SEAT_HEADER } from '../../src/mcp/constants.js';

const KEY = 'a1'.repeat(32);
const OLD_KEY = 'b2'.repeat(32);
const URL_BASE = 'http://127.0.0.1:7797';
const MCP_URL = `${URL_BASE}/mcp`;

const getOutput = ({ key = KEY, seat = true, status = '✔ Connected', url = MCP_URL } = {}) =>
  [
    'messhall:',
    '  Scope: User config (available in all your projects)',
    `  Status: ${status}`,
    '  Type: http',
    `  URL: ${url}`,
    '  Headers:',
    `    X-Messhall-Key: ${key}`,
    ...(seat ? [`    X-Messhall-Seat: \${MESSHALL_SEAT}`] : []),
    '',
    'To remove this server, run: claude mcp remove messhall -s user',
  ].join('\n');

const done = (stdout: string): RunResult => ({ code: 0, stderr: '', stdout });
const NOT_FOUND: RunResult = { code: 1, stderr: 'No MCP server named "messhall".', stdout: '' };

function fakeRun(answers: Record<string, RunResult[]>) {
  const calls: string[] = [];
  const run: McpDeps['run'] = (command, args) => {
    const line = [command, ...args.slice(0, 3)].join(' ');
    calls.push(line);
    const key = Object.keys(answers).find(prefix => line.startsWith(prefix));
    return Promise.resolve((key ? answers[key]?.shift() : undefined) ?? done(''));
  };
  return { calls, run };
}

const healthy = () =>
  Promise.resolve(Response.json({ live_members: 0, ok: true, rooms: 0, uptime_s: 5, version: '0.1.0' }));
const refused = () => Promise.reject(new TypeError('fetch failed'));

let home: string;
let codexConfig: string;
let geminiSettings: string;
let logs: string[];

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-mcp-cli-'));
  codexConfig = path.join(home, '.codex', 'config.toml');
  geminiSettings = path.join(home, '.gemini', 'settings.json');
  writeFileSync(path.join(home, 'agent-key'), KEY, { mode: 0o600 });
  writeFileSync(path.join(home, 'human-key'), 'c3'.repeat(32), { mode: 0o600 });
  logs = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const output = () => stripVTControlCharacters(logs.join('\n'));

function deps(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    codexConfig,
    codexSocket: path.join(home, 'app-server-control.sock'),
    confirm: () => Promise.resolve(true),
    dataDir: home,
    fetch: healthy,
    geminiSettings,
    isTty: true,
    log: line => logs.push(line),
    run: fakeRun({}).run,
    url: URL_BASE,
    ...overrides,
  };
}

const writeCodex = (text: string) => {
  mkdirSync(path.dirname(codexConfig), { recursive: true });
  writeFileSync(codexConfig, text);
};

const writeGemini = (text: string) => {
  mkdirSync(path.dirname(geminiSettings), { recursive: true });
  writeFileSync(geminiSettings, text);
};

const geminiOf = (settings: object) => `${JSON.stringify(settings, null, 2)}\n`;
const GEMINI_ENTRY = geminiEntry({ key: KEY, url: URL_BASE });

const configOf = (line: string) => JSON.parse(line.slice(line.indexOf("'") + 1, line.lastIndexOf("'"))) as unknown;

describe('readAgentKey', () => {
  it('reads the agent key file', () => {
    expect(readAgentKey(home)).toBe(KEY);
  });

  it('makes both key files with 0600 when they are missing', () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'messhall-mcp-fresh-'));

    const key = readAgentKey(fresh);

    expect(key).toMatch(/^[\da-f]{64}$/);
    expect(statSync(path.join(fresh, 'agent-key')).mode % 0o1000).toBe(0o600);
    expect(existsSync(path.join(fresh, 'human-key'))).toBe(true);
  });
});

describe('codexConfigPath', () => {
  it('lives under HOME/.codex by default', () => {
    vi.stubEnv('CODEX_HOME', '');
    vi.stubEnv('HOME', '/tmp/someone');

    expect(codexConfigPath()).toBe('/tmp/someone/.codex/config.toml');
  });

  it('honors CODEX_HOME', () => {
    vi.stubEnv('CODEX_HOME', '/tmp/codex-home');

    expect(codexConfigPath()).toBe('/tmp/codex-home/config.toml');
  });
});

describe('geminiSettingsPath', () => {
  it('lives under HOME/.gemini by default', () => {
    vi.stubEnv('GEMINI_CLI_HOME', '');
    vi.stubEnv('HOME', '/tmp/someone');

    expect(geminiSettingsPath()).toBe('/tmp/someone/.gemini/settings.json');
  });

  it('honors GEMINI_CLI_HOME', () => {
    vi.stubEnv('GEMINI_CLI_HOME', '/tmp/gemini-home');

    expect(geminiSettingsPath()).toBe('/tmp/gemini-home/.gemini/settings.json');
  });
});

describe('geminiEntry', () => {
  it('holds the http url, the key header, a ten minute timeout and trust', () => {
    expect(GEMINI_ENTRY).toStrictEqual({
      headers: { 'X-Messhall-Key': KEY },
      httpUrl: MCP_URL,
      timeout: 600_000,
      trust: true,
    });
  });
});

describe('claudeLine', () => {
  it('prints the user scope add-json line for an http server with the key header and alwaysLoad', () => {
    const line = claudeLine({ key: KEY, url: URL_BASE });

    expect(line.startsWith("claude mcp add-json -s user messhall '")).toBe(true);
    expect(configOf(line)).toStrictEqual({
      alwaysLoad: true,
      headers: { 'X-Messhall-Key': KEY, 'X-Messhall-Seat': `\${MESSHALL_SEAT:-}` },
      type: 'http',
      url: MCP_URL,
    });
  });

  it('names the headers the daemon reads', () => {
    const config = configOf(claudeLine({ key: KEY, url: URL_BASE })) as { headers: Record<string, string> };

    expect(Object.keys(config.headers).map(name => name.toLowerCase())).toStrictEqual([KEY_HEADER, SEAT_HEADER]);
  });
});

describe('codexBlock', () => {
  it('holds the url, the key header and the approve mode', () => {
    expect(codexBlock({ key: KEY, url: URL_BASE })).toBe(
      [
        '[mcp_servers.messhall]',
        `url = "${MCP_URL}"`,
        `http_headers = { "X-Messhall-Key" = "${KEY}" }`,
        'default_tools_approval_mode = "approve"',
      ].join('\n'),
    );
  });
});

describe('hasChannels', () => {
  it.each([
    ['2.1.80 (Claude Code)', true],
    ['2.1.289 (Claude Code)', true],
    ['3.0.1', true],
    ['2.1.79 (Claude Code)', false],
    ['not a version', false],
  ])('reads %s as channels %s', (version, expected) => {
    expect(hasChannels(version)).toBe(expected);
  });
});

describe('runMcpInstall --print', () => {
  it('prints the real line and runs nothing', async () => {
    const { calls, run } = fakeRun({});

    const code = await runMcpInstall({ print: true, yes: false }, deps({ fetch: refused, run }));

    expect(code).toBe(0);
    expect(calls).toStrictEqual([]);
    expect(logs[0]).toBe(claudeLine({ key: KEY, url: URL_BASE }));
    expect(output()).toContain('claude --dangerously-load-development-channels server:messhall');
    expect(output().split(KEY)).toHaveLength(2);
    expect(output()).toContain(`"httpUrl": "${MCP_URL}"`);
    expect(output()).toContain('"X-Messhall-Key": "<agent key>"');
    expect(existsSync(codexConfig)).toBe(false);
    expect(existsSync(geminiSettings)).toBe(false);
  });
});

describe('runMcpInstall claude code', () => {
  it('adds the entry, checks it connects and masks the key', async () => {
    const { calls, run } = fakeRun({ 'claude mcp get': [NOT_FOUND, done(getOutput())] });

    const code = await runMcpInstall({ print: false, yes: true }, deps({ run }));

    expect(code).toBe(0);
    expect(calls.filter(line => line.startsWith('claude'))).toStrictEqual([
      'claude mcp get messhall',
      'claude mcp add-json -s',
      'claude mcp get messhall',
    ]);
    expect(output()).toContain(claudeLine({ key: '<agent key>', url: URL_BASE }));
    expect(output()).not.toContain(KEY);
  });

  it('leaves an identical entry alone', async () => {
    const { calls, run } = fakeRun({ 'claude mcp get': [done(getOutput())] });

    const code = await runMcpInstall({ print: false, yes: true }, deps({ run }));

    expect(code).toBe(0);
    expect(calls.filter(line => line.startsWith('claude'))).toStrictEqual(['claude mcp get messhall']);
    expect(output()).toContain('already installed');
  });

  it('removes an older entry before adding the new one', async () => {
    const { calls, run } = fakeRun({ 'claude mcp get': [done(getOutput({ key: OLD_KEY })), done(getOutput())] });

    await runMcpInstall({ print: false, yes: true }, deps({ run }));

    expect(calls.filter(line => line.startsWith('claude'))).toStrictEqual([
      'claude mcp get messhall',
      'claude mcp remove -s',
      'claude mcp add-json -s',
      'claude mcp get messhall',
    ]);
  });

  it('replaces an entry with no seat header', async () => {
    const { calls, run } = fakeRun({ 'claude mcp get': [done(getOutput({ seat: false })), done(getOutput())] });

    await runMcpInstall({ print: false, yes: true }, deps({ run }));

    expect(calls.filter(line => line.startsWith('claude'))).toContain('claude mcp remove -s');
  });

  it('exits 1 with messhall start when the daemon is down, before touching anything', async () => {
    const { calls, run } = fakeRun({});

    const code = await runMcpInstall({ print: false, yes: true }, deps({ fetch: refused, run }));

    expect(code).toBe(1);
    expect(calls).toStrictEqual([]);
    expect(output()).toContain('messhall start');
  });

  it('exits 1 when claude cannot connect after the add', async () => {
    const failed = getOutput({ status: '✘ Failed to connect' });
    const { run } = fakeRun({ 'claude mcp get': [NOT_FOUND, done(failed)] });

    const code = await runMcpInstall({ print: false, yes: true }, deps({ run }));

    expect(code).toBe(1);
    expect(output()).toContain('Failed to connect');
  });
});

describe('runMcpInstall codex', () => {
  const claudeDone = () => fakeRun({ 'claude mcp get': [done(getOutput())] }).run;

  it('appends the block to a config that has none and keeps a backup', async () => {
    writeCodex('model = "gpt"\n');

    await runMcpInstall({ print: false, yes: true }, deps({ run: claudeDone() }));

    expect(readFileSync(codexConfig, 'utf8')).toBe(`model = "gpt"\n\n${codexBlock({ key: KEY, url: URL_BASE })}\n`);
    expect(readFileSync(`${codexConfig}.bak`, 'utf8')).toBe('model = "gpt"\n');
    expect(output()).not.toContain(KEY);
  });

  it('creates the config when there is none', async () => {
    await runMcpInstall({ print: false, yes: true }, deps({ run: claudeDone() }));

    expect(readFileSync(codexConfig, 'utf8')).toBe(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
  });

  it('leaves an identical block alone without asking', async () => {
    const text = `model = "gpt"\n\n${codexBlock({ key: KEY, url: URL_BASE })}\n`;
    writeCodex(text);
    const confirm = vi.fn(() => Promise.resolve(true));

    await runMcpInstall({ print: false, yes: false }, deps({ confirm, run: claudeDone() }));

    expect(confirm).not.toHaveBeenCalled();
    expect(readFileSync(codexConfig, 'utf8')).toBe(text);
    expect(existsSync(`${codexConfig}.bak`)).toBe(false);
  });

  it('replaces an older block in place', async () => {
    const older = [
      'model = "gpt"',
      '',
      '[mcp_servers.messhall]',
      'url = "http://127.0.0.1:7707/mcp"',
      `http_headers = { "X-Messhall-Key" = "${OLD_KEY}" }`,
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
    ].join('\n');
    writeCodex(older);

    await runMcpInstall({ print: false, yes: false }, deps({ run: claudeDone() }));

    expect(readFileSync(codexConfig, 'utf8')).toBe(
      [
        'model = "gpt"',
        '',
        codexBlock({ key: KEY, url: URL_BASE }),
        '',
        '[mcp_servers.other]',
        'command = "other"',
        '',
      ].join('\n'),
    );
    expect(readFileSync(`${codexConfig}.bak`, 'utf8')).toBe(older);
  });

  it('leaves the file alone when the user says no', async () => {
    writeCodex('model = "gpt"\n');

    const code = await runMcpInstall(
      { print: false, yes: false },
      deps({ confirm: () => Promise.resolve(false), run: claudeDone() }),
    );

    expect(code).toBe(0);
    expect(readFileSync(codexConfig, 'utf8')).toBe('model = "gpt"\n');
  });

  it('refuses a pipe without --yes before running anything', async () => {
    const { calls, run } = fakeRun({});

    const code = await runMcpInstall({ print: false, yes: false }, deps({ isTty: false, run }));

    expect(code).toBe(1);
    expect(calls).toStrictEqual([]);
    expect(output()).toContain('Not a terminal.');
    expect(output()).toContain('--yes');
    expect(existsSync(codexConfig)).toBe(false);
  });
});

describe('runMcpInstall gemini', () => {
  const claudeDone = () => fakeRun({ 'claude mcp get': [done(getOutput())] }).run;

  beforeEach(() => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
  });

  it('adds the entry and keeps the rest of the file, with a backup', async () => {
    const before = geminiOf({ mcpServers: { other: { command: 'other' } }, theme: 'dark' });
    writeGemini(before);

    const code = await runMcpInstall({ print: false, yes: true }, deps({ run: claudeDone() }));

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(geminiSettings, 'utf8'))).toStrictEqual({
      mcpServers: { messhall: GEMINI_ENTRY, other: { command: 'other' } },
      theme: 'dark',
    });
    expect(readFileSync(`${geminiSettings}.bak`, 'utf8')).toBe(before);
    expect(output()).toContain('✔ gemini: wrote');
    expect(output()).not.toContain(KEY);
  });

  it('creates settings.json when gemini has a folder but no file', async () => {
    mkdirSync(path.dirname(geminiSettings));

    await runMcpInstall({ print: false, yes: true }, deps({ run: claudeDone() }));

    expect(readFileSync(geminiSettings, 'utf8')).toBe(geminiOf({ mcpServers: { messhall: GEMINI_ENTRY } }));
  });

  it('skips gemini when there is no .gemini folder', async () => {
    const code = await runMcpInstall({ print: false, yes: true }, deps({ run: claudeDone() }));

    expect(code).toBe(0);
    expect(existsSync(path.dirname(geminiSettings))).toBe(false);
    expect(output()).toContain('gemini: no');
  });

  it('leaves an identical entry alone without asking', async () => {
    const text = geminiOf({ mcpServers: { messhall: GEMINI_ENTRY } });
    writeGemini(text);
    const confirm = vi.fn(() => Promise.resolve(true));

    await runMcpInstall({ print: false, yes: false }, deps({ confirm, run: claudeDone() }));

    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(`${geminiSettings}.bak`)).toBe(false);
    expect(output()).toContain('✔ gemini: already installed');
  });

  it('replaces an older entry after asking', async () => {
    writeGemini(geminiOf({ mcpServers: { messhall: { ...GEMINI_ENTRY, headers: { 'X-Messhall-Key': OLD_KEY } } } }));
    const confirm = vi.fn(() => Promise.resolve(true));

    await runMcpInstall({ print: false, yes: false }, deps({ confirm, run: claudeDone() }));

    expect(confirm).toHaveBeenCalledWith(`replace the messhall entry in ${geminiSettings}?`);
    expect(readFileSync(geminiSettings, 'utf8')).toBe(geminiOf({ mcpServers: { messhall: GEMINI_ENTRY } }));
  });

  it('leaves the file alone when the user says no', async () => {
    writeGemini('{}\n');

    const code = await runMcpInstall(
      { print: false, yes: false },
      deps({ confirm: () => Promise.resolve(false), run: claudeDone() }),
    );

    expect(code).toBe(0);
    expect(readFileSync(geminiSettings, 'utf8')).toBe('{}\n');
    expect(output()).toContain('gemini: skipped, nothing written');
  });

  it('exits 1 and writes nothing when settings.json is not plain json', async () => {
    const text = '{\n  // mine\n  "theme": "dark"\n}\n';
    writeGemini(text);

    const code = await runMcpInstall({ print: false, yes: true }, deps({ run: claudeDone() }));

    expect(code).toBe(1);
    expect(readFileSync(geminiSettings, 'utf8')).toBe(text);
    expect(output()).toContain(`✖ gemini: ${geminiSettings} is not plain JSON`);
  });

  it('refuses a pipe without --yes when only gemini needs a write', async () => {
    writeGemini('{}\n');
    const { calls, run } = fakeRun({});

    const code = await runMcpInstall({ print: false, yes: false }, deps({ isTty: false, run }));

    expect(code).toBe(1);
    expect(calls).toStrictEqual([]);
    expect(output()).toContain('Not a terminal.');
    expect(readFileSync(geminiSettings, 'utf8')).toBe('{}\n');
  });
});

describe('runMcpDoctor', () => {
  const versions = {
    'claude --version': [done('2.1.289 (Claude Code)')],
    'codex --version': [done('codex-cli 0.157.1')],
    'tmux -V': [done('tmux 3.5a')],
  };

  it('is all green when everything matches', async () => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
    const { run } = fakeRun({ ...versions, 'claude mcp get': [done(getOutput())] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(0);
    expect(output()).not.toContain('✖');
    expect(output()).toContain('✔ daemon');
    expect(output()).toContain('✔ claude entry');
    expect(output()).toContain('✔ codex entry');
    expect(output()).toContain('has channels');
    expect(output()).toContain('✔ tmux: tmux 3.5a');
    expect(output()).toMatch(/✔ tool join \d+\/1500 chars/);
    expect(output()).not.toContain(KEY);
  });

  it('goes red when tmux is missing, since spawn runs every agent in it', async () => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
    const { run } = fakeRun({ ...versions, 'claude mcp get': [done(getOutput())], 'tmux -V': [NOT_FOUND] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(1);
    expect(output()).toContain('✖ tmux: not found, messhall spawn needs it. brew install tmux');
  });

  it('goes red on a stale key in both entries', async () => {
    writeCodex(`${codexBlock({ key: OLD_KEY, url: URL_BASE })}\n`);
    const { run } = fakeRun({ ...versions, 'claude mcp get': [done(getOutput({ key: OLD_KEY }))] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(1);
    expect(output()).toContain('✖ claude entry: key does not match the agent key file');
    expect(output()).toContain('✖ codex entry');
    expect(output()).not.toContain(OLD_KEY);
  });

  it('goes red when the claude entry has no seat header', async () => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
    const { run } = fakeRun({ ...versions, 'claude mcp get': [done(getOutput({ seat: false }))] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(1);
    expect(output()).toContain('✖ claude entry: no seat header, so a seat is not kept over a reconnect');
  });

  it('goes red when the claude entry points at another port', async () => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
    const other = getOutput({ url: 'http://127.0.0.1:7707/mcp' });
    const { run } = fakeRun({ ...versions, 'claude mcp get': [done(other)] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(1);
    expect(output()).toContain(`✖ claude entry: points at http://127.0.0.1:7707/mcp, not ${MCP_URL}`);
  });

  it('goes red when the daemon is down and the entries are missing', async () => {
    const { run } = fakeRun({ ...versions, 'claude mcp get': [NOT_FOUND] });

    const code = await runMcpDoctor(deps({ fetch: refused, run }));

    expect(code).toBe(1);
    expect(output()).toContain('✖ daemon');
    expect(output()).toContain('messhall start');
    expect(output()).toContain('✖ claude entry: missing');
    expect(output()).toContain('✖ codex entry: missing');
  });
});

describe('runMcpDoctor gemini', () => {
  const run = () =>
    fakeRun({
      'claude --version': [done('2.1.289 (Claude Code)')],
      'claude mcp get': [done(getOutput())],
      'codex --version': [done('codex-cli 0.157.1')],
      'tmux -V': [done('tmux 3.5a')],
    }).run;

  beforeEach(() => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
  });

  it('is a dim info line when gemini is not set up', async () => {
    const code = await runMcpDoctor(deps({ run: run() }));

    expect(code).toBe(0);
    expect(logs).toContain(pc.dim(`gemini entry: no ${path.dirname(geminiSettings)}, gemini not set up`));
  });

  it('is green when the entry matches', async () => {
    writeGemini(geminiOf({ mcpServers: { messhall: GEMINI_ENTRY } }));

    const code = await runMcpDoctor(deps({ run: run() }));

    expect(code).toBe(0);
    expect(output()).toContain(`✔ gemini entry: ${MCP_URL} with the agent key`);
    expect(output()).not.toContain(KEY);
  });

  it.each([
    ['missing', '{}\n', '✖ gemini entry: missing'],
    [
      'stale',
      geminiOf({ mcpServers: { messhall: { ...GEMINI_ENTRY, headers: { 'X-Messhall-Key': OLD_KEY } } } }),
      '✖ gemini entry: url, key, timeout or trust is out of date',
    ],
    ['not plain json', '{ // mine\n}', '✖ gemini entry: '],
  ])('goes red when the entry is %s', async (_, text, line) => {
    writeGemini(text);

    const code = await runMcpDoctor(deps({ run: run() }));

    expect(code).toBe(1);
    expect(output()).toContain(line);
    expect(output()).not.toContain(OLD_KEY);
  });
});

describe('codexTuis', () => {
  it('keeps codex tuis and drops the daemon, helpers and other subcommands', () => {
    const ps = [
      '  PID ARGS',
      '  101 codex',
      '  102 /opt/homebrew/bin/codex resume 019a',
      '  103 codex app-server',
      '  104 /Users/someone/.codex/packages/app-server-daemon/current/bin/codex app-server --listen unix://',
      '  105 /opt/homebrew/Caskroom/codex/0.157.1/bin/codex-code-mode-host',
      '  106 node /tmp/plugins/codex/scripts/app-server-broker.mjs serve',
      '  107 codex exec hello',
      '  108 codex -c model=o3',
    ].join('\n');

    expect(codexTuis(ps)).toStrictEqual([
      { flag: null, pid: 101 },
      { flag: null, pid: 102 },
      { flag: '-c', pid: 108 },
    ]);
  });

  it.each([
    ['codex -c model=o3', '-c'],
    ['codex --config model=o3', '--config'],
    ['codex --enable web_search', '--enable'],
    ['codex --disable apps', '--disable'],
    ['codex --search', '--search'],
    ['codex --no-daemon', '--no-daemon'],
  ])('flags %s as embedded by %s', (args, flag) => {
    expect(codexTuis(`PID ARGS\n  7 ${args}`)).toStrictEqual([{ flag, pid: 7 }]);
  });
});

describe('runMcpDoctor codex sessions', () => {
  const versions = () => ({
    'claude --version': [done('2.1.289 (Claude Code)')],
    'claude mcp get': [done(getOutput())],
    'codex --version': [done('codex-cli 0.157.1')],
    'tmux -V': [done('tmux 3.5a')],
  });
  const socket = () => path.join(home, 'app-server-control.sock');

  beforeEach(() => {
    writeCodex(`${codexBlock({ key: KEY, url: URL_BASE })}\n`);
  });

  it('is a dim info line, not red, with no socket and no codex running', async () => {
    const { run } = fakeRun({ ...versions(), 'ps -axo pid,args': [done('  PID ARGS\n  1 /sbin/launchd')] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(0);
    expect(output()).not.toContain('✖');
    expect(logs).toContain(pc.dim('codex sessions: no shared daemon and no codex running'));
  });

  it('is green when codex tuis run on the shared daemon', async () => {
    writeFileSync(socket(), '');
    const { run } = fakeRun({
      ...versions(),
      'ps -axo pid,args': [done('  PID ARGS\n  101 codex\n  103 codex app-server')],
    });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(0);
    expect(output()).toContain('✔ codex sessions: shared daemon up, 1 codex running');
  });

  it('flags an embedded codex by pid and flag and never prints its args', async () => {
    writeFileSync(socket(), '');
    const ps = '  PID ARGS\n  101 codex\n  108 codex -c secret_value=1';
    const { run } = fakeRun({ ...versions(), 'ps -axo pid,args': [done(ps)] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(1);
    expect(output()).toContain('✖ codex pid 108 started with -c: embedded, cannot be rung (fall back to wait)');
    expect(output()).not.toContain('secret_value');
  });

  it('is a dim info line when codex runs but the shared daemon socket is not there', async () => {
    const { run } = fakeRun({ ...versions(), 'ps -axo pid,args': [done('  PID ARGS\n  101 codex')] });

    const code = await runMcpDoctor(deps({ run }));

    expect(code).toBe(0);
    expect(logs).toContain(pc.dim(`codex sessions: 1 codex running, no shared daemon socket at ${socket()}`));
  });
});

describe('runMcpUninstall', () => {
  it('removes the claude entry and the codex block with a backup, and leaves the data alone', async () => {
    const text = `model = "gpt"\n\n${codexBlock({ key: KEY, url: URL_BASE })}\n`;
    writeCodex(text);
    const { calls, run } = fakeRun({});

    const code = await runMcpUninstall({ yes: true }, deps({ run }));

    expect(code).toBe(0);
    expect(calls).toStrictEqual(['claude mcp remove -s']);
    expect(readFileSync(codexConfig, 'utf8')).toBe('model = "gpt"\n');
    expect(readFileSync(`${codexConfig}.bak`, 'utf8')).toBe(text);
    expect(readFileSync(path.join(home, 'agent-key'), 'utf8')).toBe(KEY);
  });

  it('says there was nothing to remove', async () => {
    const { run } = fakeRun({ 'claude mcp remove': [NOT_FOUND] });

    const code = await runMcpUninstall({ yes: true }, deps({ run }));

    expect(code).toBe(0);
    expect(output()).toContain('claude code: no messhall entry');
    expect(output()).toContain('codex: no messhall block');
    expect(output()).toContain('gemini: no messhall entry');
  });

  it('removes only the messhall entry from the gemini settings, with a backup', async () => {
    const before = geminiOf({ mcpServers: { messhall: GEMINI_ENTRY, other: { command: 'other' } }, theme: 'dark' });
    writeGemini(before);

    const code = await runMcpUninstall({ yes: true }, deps({ run: fakeRun({}).run }));

    expect(code).toBe(0);
    expect(readFileSync(geminiSettings, 'utf8')).toBe(
      geminiOf({ mcpServers: { other: { command: 'other' } }, theme: 'dark' }),
    );
    expect(readFileSync(`${geminiSettings}.bak`, 'utf8')).toBe(before);
    expect(output()).toContain('✔ gemini: removed the messhall entry');
  });

  it('refuses a pipe without --yes when gemini has an entry', async () => {
    const text = geminiOf({ mcpServers: { messhall: GEMINI_ENTRY } });
    writeGemini(text);
    const { calls, run } = fakeRun({});

    const code = await runMcpUninstall({ yes: false }, deps({ isTty: false, run }));

    expect(code).toBe(1);
    expect(calls).toStrictEqual([]);
    expect(readFileSync(geminiSettings, 'utf8')).toBe(text);
  });
});
