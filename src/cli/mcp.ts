import type { McpSession } from '../mcp/session.js';
import type { Command } from 'commander';

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { confirm as clackConfirm, isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { createCodexClient } from '../codex/client.js';
import { codexConfigPath, codexControlSocket, daemonUrl, dataDir, geminiSettingsPath } from '../config.js';
import { readBlock, withBlock, withoutBlock } from '../lib/codexToml.js';
import { runCommand } from '../lib/run.js';
import { parseSettings, readServer, withoutServer, withServer } from '../lib/settingsJson.js';
import { SEAT_ENV, SERVER_NAME, TEXT_BUDGET } from '../mcp/constants.js';
import { createMesshallServer } from '../mcp/server.js';
import { createSession, createSessionRegistry } from '../mcp/session.js';
import { connectInMemory } from '../mcp/testing.js';
import { openDb } from '../rooms/db.js';
import { createRoomStore } from '../rooms/store.js';

import { readAgentKey } from './agentKey.js';
import { probeHealth } from './status.js';

const CLAUDE = 'claude';
// Codex fails the MCP handshake with the lowercase name, so this spelling is load-bearing.
export const KEY_HEADER_NAME = 'X-Messhall-Key';
const SEAT_HEADER_NAME = 'X-Messhall-Seat';
// Claude Code fills this from its own env, empty when the session was not started by messhall claude.
const SEAT_VALUE = `\${${SEAT_ENV}:-}`;
const MASK = '<agent key>';
const CODEX_HEADER = `[mcp_servers.${SERVER_NAME}]`;
// Codex asks before every MCP tool call by default, which stalls a room.
const CODEX_APPROVAL = 'approve';
// Gemini's own default, written out so a long wait call is never cut short by a lower one.
const GEMINI_TIMEOUT_MS = 600_000;
const CHANNEL_LINE = `claude --dangerously-load-development-channels server:${SERVER_NAME}`;
// Claude Code shipped Channels in this release.
const CHANNELS_SINCE = [2, 1, 80] as const;

const ADD_ARGS = ['mcp', 'add-json', '-s', 'user', SERVER_NAME];
const GET_ARGS = ['mcp', 'get', SERVER_NAME];
const REMOVE_ARGS = ['mcp', 'remove', '-s', 'user', SERVER_NAME];

type EntryState = 'absent' | 'older' | 'same';

export interface McpDeps {
  codexConfig: string;
  codexSocket: string;
  confirm: (message: string) => Promise<boolean>;
  dataDir: string;
  fetch: Parameters<typeof probeHealth>[0]['fetch'];
  geminiSettings: string;
  isTty: boolean;
  log: (line: string) => void;
  run: typeof runCommand;
  url: string;
}

interface Where {
  key: string;
  url: string;
}

interface Check {
  good: boolean;
  info?: boolean;
  line: string;
}

const ok = (text: string) => pc.green(`✔ ${text}`);
const bad = (text: string) => pc.red(`✖ ${text}`);
const dim = (text: string) => pc.dim(text);

const mcpUrl = (url: string) => `${url}/mcp`;

function claudeConfig({ key, url }: Where) {
  const headers = { [KEY_HEADER_NAME]: key, [SEAT_HEADER_NAME]: SEAT_VALUE };
  return JSON.stringify({ type: 'http', url: mcpUrl(url), headers, alwaysLoad: true });
}

/** The `claude mcp add-json` line that adds messhall at user scope. */
export function claudeLine(where: Where) {
  return [CLAUDE, ...ADD_ARGS, `'${claudeConfig(where)}'`].join(' ');
}

/** The `[mcp_servers.messhall]` table for `~/.codex/config.toml`. */
export function codexBlock({ key, url }: Where) {
  return [
    CODEX_HEADER,
    `url = "${mcpUrl(url)}"`,
    `http_headers = { "${KEY_HEADER_NAME}" = "${key}" }`,
    `default_tools_approval_mode = "${CODEX_APPROVAL}"`,
  ].join('\n');
}

/** The `mcpServers.messhall` entry for Gemini CLI's settings. `trust` skips the ask before every tool call. */
export function geminiEntry({ key, url }: Where) {
  return { headers: { [KEY_HEADER_NAME]: key }, httpUrl: mcpUrl(url), timeout: GEMINI_TIMEOUT_MS, trust: true };
}

const geminiJson = (where: Where) => JSON.stringify({ mcpServers: { [SERVER_NAME]: geminiEntry(where) } }, null, 2);

/** True when a `claude --version` line is 2.1.80 or newer. */
export function hasChannels(version: string) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  const index = parts.findIndex((part, at) => part !== CHANNELS_SINCE[at]);
  return index === -1 || parts[index]! > CHANNELS_SINCE[index]!;
}

const field = (output: string, name: string) =>
  new RegExp(`^\\s*${name}: (.*)$`, 'm').exec(output)?.[1]?.trim() ?? null;

/** What `claude mcp get messhall` says, or null when Claude Code has no messhall entry. */
export async function readClaudeEntry(run: McpDeps['run']) {
  const result = await run(CLAUDE, GET_ARGS);
  if (result.code !== 0) return null;
  return {
    connected: /Status: .*Connected/.test(result.stdout),
    key: field(result.stdout, KEY_HEADER_NAME),
    seat: field(result.stdout, SEAT_HEADER_NAME) !== null,
    status: field(result.stdout, 'Status') ?? '',
    url: field(result.stdout, 'URL'),
  };
}

type ClaudeEntry = Awaited<ReturnType<typeof readClaudeEntry>>;

const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** The messhall block in the Codex config, or null when there is none. */
export const readCodexEntry = (file: string) => readBlock({ block: CODEX_HEADER, text: readText(file) });

function claudeState(entry: ClaudeEntry, where: Where): EntryState {
  if (!entry) return 'absent';
  return entry.url === mcpUrl(where.url) && entry.key === where.key && entry.seat ? 'same' : 'older';
}

function codexState(file: string, where: Where): EntryState {
  const found = readCodexEntry(file);
  if (found === null) return 'absent';
  return found === codexBlock(where) ? 'same' : 'older';
}

/** Gemini's parsed settings and how its messhall entry compares to `where`. No `.gemini` dir means gemini is not set up. */
function readGemini(file: string, where: Where) {
  if (!existsSync(path.dirname(file))) return { settings: null, state: 'not set up' } as const;
  const settings = parseSettings(readText(file));
  if (!settings) return { settings, state: 'invalid' } as const;
  const found = readServer({ name: SERVER_NAME, settings });
  const state: EntryState =
    found === undefined ? 'absent' : isDeepStrictEqual(found, geminiEntry(where)) ? 'same' : 'older';
  return { settings, state };
}

/** Writes `text` to `file`, copying the old file to `<file>.bak` first. */
function writeWithBackup(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  writeFileSync(file, text);
}

const notTerminal = (flags: string) => [bad('Not a terminal.'), dim(flags)];

async function installClaude(deps: McpDeps, where: Where) {
  const entry = await readClaudeEntry(deps.run);
  const state = claudeState(entry, where);
  if (state === 'same') {
    deps.log(ok('claude code: already installed'));
    return true;
  }
  deps.log(claudeLine({ ...where, key: MASK }));
  if (state === 'older') await deps.run(CLAUDE, REMOVE_ARGS);
  const added = await deps.run(CLAUDE, [...ADD_ARGS, claudeConfig(where)]);
  if (added.code !== 0) {
    deps.log(bad(`claude code: claude mcp add-json failed: ${(added.stderr || added.stdout).trim()}`));
    return false;
  }
  const after = await readClaudeEntry(deps.run);
  if (!after?.connected) {
    deps.log(bad(`claude code: added, but claude mcp get says ${after?.status || 'nothing'}`));
    return false;
  }
  deps.log(ok(state === 'older' ? 'claude code: replaced the older entry' : 'claude code: installed'));
  return true;
}

function channelNote(log: McpDeps['log']) {
  log(dim('start a claude session that gets doorbells with:'));
  log(dim(`  ${CHANNEL_LINE}`));
  log(dim('  it shows one warning dialog for the dev channel. plain --channels does not take messhall.'));
}

async function installCodex(deps: McpDeps, where: Where, { yes }: { yes: boolean }) {
  const file = deps.codexConfig;
  const state = codexState(file, where);
  if (state === 'same') return deps.log(ok('codex: already installed'));
  deps.log(dim(codexBlock({ ...where, key: MASK })));
  const question = state === 'older' ? `replace the messhall block in ${file}?` : `add this to ${file}?`;
  if (!yes && !(await deps.confirm(question))) return deps.log(dim('codex: skipped, nothing written'));
  const backup = existsSync(file) ? ', backup at config.toml.bak' : '';
  writeWithBackup(file, withBlock({ block: codexBlock(where), text: readText(file) }));
  deps.log(ok(`codex: wrote ${file}${backup}`));
}

async function installGemini(deps: McpDeps, where: Where, { yes }: { yes: boolean }) {
  const file = deps.geminiSettings;
  const { settings, state } = readGemini(file, where);
  if (state === 'not set up') {
    deps.log(dim(`gemini: no ${path.dirname(file)}, skipped`));
    return true;
  }
  if (!settings) {
    deps.log(bad(`gemini: ${file} is not plain JSON, add the entry from messhall mcp install --print by hand`));
    return false;
  }
  if (state === 'same') {
    deps.log(ok('gemini: already installed'));
    return true;
  }
  deps.log(dim(geminiJson({ ...where, key: MASK })));
  const question = state === 'older' ? `replace the messhall entry in ${file}?` : `add this to ${file}?`;
  if (!yes && !(await deps.confirm(question))) {
    deps.log(dim('gemini: skipped, nothing written'));
    return true;
  }
  const backup = existsSync(file) ? ', backup at settings.json.bak' : '';
  writeWithBackup(file, withServer({ entry: geminiEntry(where), name: SERVER_NAME, settings }));
  deps.log(ok(`gemini: wrote ${file}${backup}`));
  return true;
}

/** Adds messhall to Claude Code, Codex and Gemini CLI. The key shows only in the `--print` line.
 * The daemon has to be up, since the add is checked by connecting to it. */
export async function runMcpInstall({ print, yes }: { print: boolean; yes: boolean }, deps: McpDeps) {
  const where = { key: readAgentKey(deps.dataDir), url: deps.url };
  if (print) {
    deps.log(claudeLine(where));
    channelNote(deps.log);
    deps.log(dim(`codex, written to ${deps.codexConfig} by messhall mcp install:`));
    deps.log(dim(codexBlock({ ...where, key: MASK })));
    deps.log(dim(`gemini, written to ${deps.geminiSettings} by messhall mcp install:`));
    deps.log(dim(geminiJson({ ...where, key: MASK })));
    return 0;
  }
  const probe = await probeHealth({ fetch: deps.fetch, url: deps.url });
  if (probe.state !== 'up') {
    deps.log(bad(`messhall is not running on ${deps.url}. run messhall start, then try again`));
    return 1;
  }
  const geminiWrites = ['absent', 'older'].includes(readGemini(deps.geminiSettings, where).state);
  if (!yes && !deps.isTty && (codexState(deps.codexConfig, where) !== 'same' || geminiWrites)) {
    notTerminal('rerun with --yes to write the codex and gemini configs, or --print to only see the lines').forEach(
      deps.log,
    );
    return 1;
  }
  const claudeOk = await installClaude(deps, where);
  channelNote(deps.log);
  await installCodex(deps, where, { yes });
  const geminiOk = await installGemini(deps, where, { yes });
  return claudeOk && geminiOk ? 0 : 1;
}

async function toolChecks(): Promise<Check[]> {
  const home = mkdtempSync(path.join(tmpdir(), 'messhall-doctor-'));
  const db = openDb({ dataDir: home });
  const now = () => new Date();
  const session = createSession({ id: 'doctor', now });
  const sessions = createSessionRegistry<{ session: McpSession }>();
  const store = createRoomStore({ db, now });
  const codex = createCodexClient({ socketPath: codexControlSocket() });
  const client = await connectInMemory(() => createMesshallServer({ codex, now, session, sessions, store }));
  try {
    const { tools } = await client.listTools();
    return tools.map(tool => {
      const length = tool.description?.length ?? 0;
      return { good: length <= TEXT_BUDGET, line: `tool ${tool.name} ${length}/${TEXT_BUDGET} chars` };
    });
  } finally {
    await client.close();
    codex.close();
    db.close();
    rmSync(home, { force: true, recursive: true });
  }
}

function claudeEntryCheck(entry: ClaudeEntry, where: Where): Check {
  const want = mcpUrl(where.url);
  if (!entry) return { good: false, line: 'claude entry: missing, run messhall mcp install' };
  if (entry.url !== want) {
    return { good: false, line: `claude entry: points at ${entry.url}, not ${want}. run messhall mcp install` };
  }
  if (entry.key !== where.key) {
    return { good: false, line: 'claude entry: key does not match the agent key file. run messhall mcp install' };
  }
  if (!entry.seat) {
    return {
      good: false,
      line: 'claude entry: no seat header, so a seat is not kept over a reconnect. run messhall mcp install',
    };
  }
  return { good: true, line: `claude entry: ${want} with the agent key and the seat header` };
}

function codexEntryCheck(file: string, where: Where): Check {
  const state = codexState(file, where);
  if (state === 'absent') return { good: false, line: `codex entry: missing from ${file}, run messhall mcp install` };
  if (state === 'older') {
    return { good: false, line: 'codex entry: url, key or approval mode is out of date. run messhall mcp install' };
  }
  return { good: true, line: `codex entry: ${mcpUrl(where.url)} with the agent key, tools ${CODEX_APPROVAL}` };
}

function geminiEntryCheck(file: string, where: Where): Check {
  const { state } = readGemini(file, where);
  if (state === 'not set up') {
    return { good: true, info: true, line: `gemini entry: no ${path.dirname(file)}, gemini not set up` };
  }
  if (state === 'invalid') return { good: false, line: `gemini entry: ${file} is not plain JSON` };
  if (state === 'absent') return { good: false, line: `gemini entry: missing from ${file}, run messhall mcp install` };
  if (state === 'older') {
    return { good: false, line: 'gemini entry: url, key, timeout or trust is out of date. run messhall mcp install' };
  }
  return { good: true, line: `gemini entry: ${mcpUrl(where.url)} with the agent key, trusted` };
}

async function versionCheck(run: McpDeps['run'], name: string): Promise<Check> {
  const result = await run(name, ['--version']);
  const version = result.stdout.trim().split('\n')[0] ?? '';
  if (result.code !== 0 || !version) return { good: false, line: `${name}: not found` };
  if (name !== CLAUDE) return { good: true, line: `${name}: ${version}` };
  return hasChannels(version)
    ? { good: true, line: `${name}: ${version}, has channels` }
    : { good: false, line: `${name}: ${version}, no channels, needs 2.1.80 or newer` };
}

// Codex subcommands that are not a TUI a user types into.
const NOT_TUI = new Set([
  'a',
  'agents',
  'app',
  'app-server',
  'apply',
  'archive',
  'completion',
  'debug',
  'delete',
  'doctor',
  'e',
  'exec',
  'login',
  'logout',
  'mcp',
  'mcp-server',
  'plugin',
  'queue',
  'remote-control',
  'review',
  'sandbox',
  'update',
]);
// Any of these starts codex embedded, off the shared daemon, so no doorbell reaches it.
const EMBEDDED_FLAGS = ['-c', '--config', '--enable', '--disable', '--search', '--no-daemon'];

/** Codex TUIs in `ps -axo pid,args` output, each with the flag that made it embedded, or null. */
export function codexTuis(ps: string) {
  return ps
    .split('\n')
    .slice(1)
    .flatMap(line => {
      const [pid, bin, ...args] = line.trim().split(/\s+/);
      if (!pid || !bin || path.basename(bin) !== 'codex' || NOT_TUI.has(args[0] ?? '')) return [];
      const flag = EMBEDDED_FLAGS.find(name => args.some(arg => arg === name || arg.startsWith(`${name}=`)));
      return [{ flag: flag ?? null, pid: Number(pid) }];
    });
}

/** One line for the shared daemon, plus a red line per embedded TUI. Only pid and flag show, since args can hold secrets. */
async function codexSessionChecks(deps: McpDeps): Promise<Check[]> {
  const tuis = codexTuis((await deps.run('ps', ['-axo', 'pid,args'])).stdout);
  const socket = existsSync(deps.codexSocket);
  const running = `${tuis.length} codex running`;
  const summary: Check = socket
    ? { good: true, line: `codex sessions: shared daemon up, ${running}` }
    : {
        good: true,
        info: true,
        line: tuis.length
          ? `codex sessions: ${running}, no shared daemon socket at ${deps.codexSocket}`
          : 'codex sessions: no shared daemon and no codex running',
      };
  const embedded = tuis.flatMap(({ flag, pid }) =>
    flag
      ? [{ good: false, line: `codex pid ${pid} started with ${flag}: embedded, cannot be rung (fall back to wait)` }]
      : [],
  );
  return [summary, ...embedded];
}

/** One green or red line per check. Returns 1 when any line is red. */
export async function runMcpDoctor(deps: McpDeps) {
  const where = { key: readAgentKey(deps.dataDir), url: deps.url };
  const probe = await probeHealth({ fetch: deps.fetch, url: deps.url });
  const daemon: Check =
    probe.state === 'up'
      ? { good: true, line: `daemon: up on ${deps.url}, v${probe.health.version}` }
      : { good: false, line: `daemon: nothing answers on ${deps.url}. run messhall start` };
  const checks = [
    daemon,
    claudeEntryCheck(await readClaudeEntry(deps.run), where),
    codexEntryCheck(deps.codexConfig, where),
    geminiEntryCheck(deps.geminiSettings, where),
    await versionCheck(deps.run, CLAUDE),
    await versionCheck(deps.run, 'codex'),
    ...(await codexSessionChecks(deps)),
    ...(await toolChecks()),
  ];
  checks.forEach(check => deps.log(check.info ? dim(check.line) : check.good ? ok(check.line) : bad(check.line)));
  return checks.every(check => check.good) ? 0 : 1;
}

async function uninstallCodex(deps: McpDeps, { yes }: { yes: boolean }) {
  const file = deps.codexConfig;
  if (readCodexEntry(file) === null) return deps.log(dim('codex: no messhall block'));
  if (!yes && !(await deps.confirm(`remove the messhall block from ${file}?`))) {
    return deps.log(dim('codex: skipped, nothing written'));
  }
  writeWithBackup(file, withoutBlock({ header: CODEX_HEADER, text: readText(file) }));
  deps.log(ok('codex: removed the messhall block, backup at config.toml.bak'));
}

/** Gemini's parsed settings when they hold a messhall entry, else null. */
function geminiWithEntry(file: string) {
  const settings = parseSettings(readText(file));
  return settings && readServer({ name: SERVER_NAME, settings }) !== undefined ? settings : null;
}

async function uninstallGemini(deps: McpDeps, { yes }: { yes: boolean }) {
  const file = deps.geminiSettings;
  const settings = geminiWithEntry(file);
  if (!settings) return deps.log(dim('gemini: no messhall entry'));
  if (!yes && !(await deps.confirm(`remove the messhall entry from ${file}?`))) {
    return deps.log(dim('gemini: skipped, nothing written'));
  }
  writeWithBackup(file, withoutServer({ name: SERVER_NAME, settings }));
  deps.log(ok('gemini: removed the messhall entry, backup at settings.json.bak'));
}

/** Removes the Claude Code entry, the Codex block and the Gemini entry. The daemon and the data dir stay. */
export async function runMcpUninstall({ yes }: { yes: boolean }, deps: McpDeps) {
  const edits = readCodexEntry(deps.codexConfig) !== null || geminiWithEntry(deps.geminiSettings) !== null;
  if (edits && !yes && !deps.isTty) {
    notTerminal('rerun with --yes to edit the codex and gemini configs').forEach(deps.log);
    return 1;
  }
  const removed = await deps.run(CLAUDE, REMOVE_ARGS);
  deps.log(removed.code === 0 ? ok('claude code: removed the messhall entry') : dim('claude code: no messhall entry'));
  await uninstallCodex(deps, { yes });
  await uninstallGemini(deps, { yes });
  return 0;
}

async function confirmPrompt(message: string) {
  const answer = await clackConfirm({ message });
  return !isCancel(answer) && answer;
}

const systemDeps = (): McpDeps => ({
  codexConfig: codexConfigPath(),
  codexSocket: codexControlSocket(),
  confirm: confirmPrompt,
  dataDir: dataDir(),
  fetch,
  geminiSettings: geminiSettingsPath(),
  isTty: Boolean(process.stdin.isTTY),
  log: line => console.log(line),
  run: runCommand,
  url: daemonUrl(),
});

/** Registers `mcp install`, `mcp doctor` and `mcp uninstall`. */
export function registerMcp(program: Command) {
  const mcp = program
    .command('mcp')
    .description('Add messhall to Claude Code, Codex and Gemini CLI, check it, or take it out.');
  mcp
    .command('install')
    .description(
      'Add messhall to Claude Code with claude mcp add-json, to the Codex config and to the Gemini settings, then check it connects.',
    )
    .option('--print', 'only print the lines, change nothing')
    .option('--yes', 'write the Codex and Gemini configs without asking')
    .action(async (options: { print?: boolean; yes?: boolean }) => {
      const flags = { print: Boolean(options.print), yes: Boolean(options.yes) };
      process.exitCode = await runMcpInstall(flags, systemDeps());
    });
  mcp
    .command('doctor')
    .description(
      'Check the daemon, the Claude, Codex and Gemini entries, the key, claude and codex versions, codex sessions, and the tools.',
    )
    .action(async () => {
      process.exitCode = await runMcpDoctor(systemDeps());
    });
  mcp
    .command('uninstall')
    .description('Remove messhall from Claude Code, Codex and Gemini CLI. Keeps the daemon and the data dir.')
    .option('--yes', 'edit the Codex and Gemini configs without asking')
    .action(async (options: { yes?: boolean }) => {
      process.exitCode = await runMcpUninstall({ yes: Boolean(options.yes) }, systemDeps());
    });
}
