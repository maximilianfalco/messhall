import type { Command } from 'commander';

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';

import { DB_FILE } from '../../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../../src/daemon/keys.js';
import { SERVER_NAME } from '../../../src/mcp/constants.js';
import { connectHttp } from '../../../src/mcp/testing.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { run } from '../lib/run.js';

import { spawnDaemon } from './daemon.js';
import { roomReport } from './room.js';

const DEFAULT_PORT = 7797;
const READY_WITHIN_MS = 60_000;
const JOIN_WITHIN_MS = 90_000;
const REPLY_WITHIN_S = 90;
// The doorbell skips a member active in the last 5 s, so the mention waits for it to settle.
const QUIET_MS = 6000;
const POLL_MS = 500;
const PANE_LINES = 16;
const REGISTERED = `MCP server "${SERVER_NAME}": Channel notifications registered`;

interface ChannelOptions {
  as: string;
  keep: boolean;
  room: string;
}

type Dialog = { keys: string[]; kind: 'answer' } | { kind: 'login' } | { kind: 'none' };

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

/** The debug log lines that prove the channel registered, the bell landed and the tools ran. */
export function proofLines(log: string) {
  const ours = `MCP server "${SERVER_NAME}"`;
  return log
    .split('\n')
    .filter(line => line.includes(ours))
    .filter(line =>
      /Channel notifications registered|notifications\/claude\/channel|read_since|"post"|: post\b/.test(line),
    );
}

const tmux = (args: string[]) => run('tmux', args, tmpdir());
const pane = async (session: string) => (await tmux(['capture-pane', '-p', '-t', session])).stdout;
const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

function memberState({ home, name, room }: { home: string; name: string; room: string }) {
  const file = path.join(home, DB_FILE);
  if (!existsSync(file)) return;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db
      .prepare(
        'SELECT members.presence, members.last_seen_at FROM members JOIN rooms ON rooms.id = members.room_id WHERE rooms.name = ? AND members.name = ? AND members.left_at IS NULL',
      )
      .get(room, name);
    return row ? { lastSeen: Date.parse(String(row.last_seen_at)), presence: String(row.presence) } : undefined;
  } finally {
    db.close();
  }
}

async function until<T>(deadline: number, check: () => Promise<T | undefined> | T | undefined): Promise<T | undefined> {
  const value = await check();
  if (value !== undefined || Date.now() > deadline) return value;
  await sleep(POLL_MS);
  return until(deadline, check);
}

/**
 * Drives a real Claude Code in tmux with messhall as a dev channel: it joins, a scripted agent
 * mentions it, and the doorbell should make it read and reply. Cleans up unless `keep`.
 */
export async function channelRun({ as, keep, room }: ChannelOptions) {
  const ownHome = !process.env.MESSHALL_HOME;
  const home = process.env.MESSHALL_HOME || mkdtempSync(path.join(tmpdir(), 'messhall-channel-'));
  const port = process.env.MESSHALL_PORT ? Number(process.env.MESSHALL_PORT) : DEFAULT_PORT;
  const cwd = mkdtempSync(path.join(tmpdir(), 'messhall-channel-cwd-'));
  const session = `messhall-channel-${port}`;
  const debugFile = path.join(home, 'channel-debug.log');
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
    console.error(dim(line));
  };

  const daemon = await spawnDaemon({ detached: keep, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  const key = readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();
  const mcpConfig = path.join(home, 'channel-mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: { [SERVER_NAME]: { headers: { [KEY_HEADER]: key }, type: 'http', url: `${daemon.url}/mcp` } },
    }),
  );
  chmodSync(mcpConfig, 0o600);

  let scripted: Awaited<ReturnType<typeof connectHttp>> | undefined;
  let code = 1;
  let replyMs: number | undefined;
  try {
    const claude = [
      'claude',
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--dangerously-load-development-channels',
      `server:${SERVER_NAME}`,
      '--allowedTools',
      `mcp__${SERVER_NAME}`,
      '--debug-file',
      debugFile,
    ].join(' ');
    await tmux(['kill-session', '-t', session]);
    const started = await tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50', '-c', cwd, claude]);
    if (started.code !== 0) throw new Error(`tmux new-session failed: ${started.stderr.trim()}`);
    note(`claude started in tmux session ${session}`);

    const ready = await until(Date.now() + READY_WITHIN_MS, async () => {
      const dialog = dialogKeys(await pane(session));
      if (dialog.kind === 'login') return 'login';
      if (dialog.kind === 'none') return readText(debugFile).includes(REGISTERED) ? 'registered' : undefined;
      note(`answering a dialog with ${dialog.keys.join(' ')}`);
      await tmux(['send-keys', '-t', session, ...dialog.keys]);
      await sleep(1000);
    });
    if (ready !== 'registered') {
      throw new Error(ready === 'login' ? 'claude wants a login, stopped' : 'channel never registered within 60 s');
    }
    note('channel registered');

    const prompt = `Join #${room} on messhall as ${as}, then end your turn. Do not call wait. When a messhall doorbell arrives, call read_since and reply to the mention with one short post.`;
    await tmux(['send-keys', '-t', session, '-l', prompt]);
    await tmux(['send-keys', '-t', session, 'Enter']);

    const joined = await until(Date.now() + JOIN_WITHIN_MS, () => {
      const state = memberState({ home, name: as, room });
      return state && state.presence !== 'waiting' && Date.now() - state.lastSeen > QUIET_MS ? state : undefined;
    });
    if (!joined) throw new Error(`${as} never joined #${room} and settled within 90 s`);
    note(`${as} joined #${room} and is quiet`);

    scripted = await connectHttp({ key, name: 'messhall-dev-channel-api', url: daemon.url });
    await scripted.client.callTool({ arguments: { as: 'api', room }, name: 'join' });
    const postedAt = Date.now();
    await scripted.client.callTool({
      arguments: { room, text: `@${as} what is 2 + 2? reply here in one line.` },
      name: 'post',
    });
    note('api posted the mention');
    const waited = await scripted.client.callTool(
      { arguments: { room, timeout_s: REPLY_WITHIN_S }, name: 'wait' },
      { resetTimeoutOnProgress: true, timeout: (REPLY_WITHIN_S + 10) * 1000 },
    );
    const waitText = waited.content.map(block => (block.type === 'text' ? block.text : '')).join('');
    if (!waitText.includes('new in')) throw new Error(`no reply from ${as} within ${REPLY_WITHIN_S} s`);
    replyMs = Date.now() - postedAt;
    code = 0;
  } catch (error) {
    lines.push(bad(error instanceof Error ? error.message : String(error)));
  } finally {
    if (scripted) {
      await scripted.transport.terminateSession().catch(() => {});
      await scripted.client.close();
    }
  }

  const proof = proofLines(readText(debugFile));
  const screen = (await pane(session))
    .split('\n')
    .filter(line => line.trim())
    .slice(-PANE_LINES);
  const transcript = roomReport({ dataDir: home, name: room });
  const report = [
    ...lines,
    '',
    proof.length ? proof.join('\n') : bad('no messhall lines in the claude debug log'),
    '',
    dim('claude pane:'),
    ...screen,
    '',
    transcript.report,
    '',
    formatTable(
      ['channel', ''],
      [
        ['room', `#${room}`],
        ['claude as', as],
        ['post to reply', replyMs === undefined ? 'no reply' : `${(replyMs / 1000).toFixed(1)} s`],
        ['debug log', debugFile],
      ],
    ),
    '',
    code === 0 ? ok(`${as} read the doorbell and replied`) : bad(`${as} did not reply`),
  ];

  if (keep) {
    report.push(dim(`left running: tmux attach -t ${session}, daemon pid ${daemon.child.pid}`));
    daemon.child.unref();
  } else {
    await tmux(['kill-session', '-t', session]);
    await daemon.stop();
    rmSync(cwd, { force: true, recursive: true });
    if (ownHome) rmSync(home, { force: true, recursive: true });
    else rmSync(mcpConfig, { force: true });
  }
  return { code, report: report.join('\n') };
}

/** Registers `channel --room <r> [--as <role>] [--keep]`. */
export function registerChannel(program: Command) {
  program
    .command('channel')
    .description('A real Claude Code in tmux on messhall as a dev channel: a mention rings it, it reads and replies.')
    .requiredOption('--room <room>', 'room to join')
    .option('--as <role>', 'the role claude joins as', 'web')
    .option('--keep', 'leave tmux and the daemon running')
    .action(async (options: { as: string; keep?: boolean; room: string }) => {
      const result = await channelRun({ ...options, keep: Boolean(options.keep) });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
