import type { Command } from 'commander';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { KEY_HEADER_NAME } from '../../../src/cli/mcp.js';
import { createCodexClient } from '../../../src/codex/client.js';
import { codexControlSocket } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { SERVER_NAME } from '../../../src/mcp/constants.js';
import { connectHttp } from '../../../src/mcp/testing.js';
import { NOTHING_YET } from '../../../src/mcp/tools/wait.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { run } from '../lib/run.js';

import { spawnDaemon } from './daemon.js';
import { roomReport } from './room.js';

const DEFAULT_PORT = 7797;
// The cheap model. It goes on thread/start, since a -c flag would put the TUI in embedded mode.
const MODEL = 'gpt-6-luna';
const READY_WITHIN_MS = 60_000;
const JOIN_WITHIN_MS = 120_000;
const REPLY_WITHIN_S = 90;
// The doorbell skips a member active in the last 5 s, so the mention waits for it to settle.
const QUIET_MS = 6000;
const POLL_MS = 500;
const PANE_LINES = 16;
// Codex cannot resume a thread with no history, so one line gives it a rollout file.
const SEED = 'messhall dev session.';

type Screen = 'error' | 'loading' | 'ready' | 'trust' | 'update';

interface CodexOptions {
  as: string;
  keep: boolean;
  quiet?: number;
  room: string;
}

/** What the Codex TUI shows. Trust is never answered, since saving it writes the user's config.toml. */
export function codexScreen(pane: string): Screen {
  if (/Update now/.test(pane)) return 'update';
  if (/Trust this folder\?/.test(pane)) return 'trust';
  if (/^\s*›?\s*Error:/m.test(pane)) return 'error';
  if (/Ask Codex to do anything|← for agents/.test(pane)) return 'ready';
  return 'loading';
}

/** One member's presence, last seen and doorbell from a list_members reply. */
export function memberStatus({ list, name }: { list: string; name: string }) {
  const pattern = String.raw`^- ${name} \((.+?)( \(no doorbell\))?, (\w+)[^)]*\), last seen (\S+)$`;
  const line = new RegExp(pattern, 'm').exec(list);
  if (!line) return;
  return { doorbell: !line[2], lastSeen: Date.parse(line[4]!), presence: line[3]! };
}

const tmux = (args: string[]) => run('tmux', args, tmpdir());
const pane = async (session: string) => (await tmux(['capture-pane', '-p', '-t', session])).stdout;
const textOf = (result: { content: { text?: string; type: string }[] }) =>
  result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('');

async function until<T>(deadline: number, check: () => Promise<T | undefined>): Promise<T | undefined> {
  const value = await check();
  if (value !== undefined || Date.now() > deadline) return value;
  await sleep(POLL_MS);
  return until(deadline, check);
}

/** Drives a real Codex TUI on the user's shared app-server daemon: it joins with its thread id,
 * a scripted agent mentions it, and the queued ring should make it read and reply. */
export async function codexRun({ as, keep, quiet, room }: CodexOptions) {
  const ownHome = !process.env.MESSHALL_HOME;
  const home = process.env.MESSHALL_HOME || mkdtempSync(path.join(tmpdir(), 'messhall-codex-'));
  const port = process.env.MESSHALL_PORT ? Number(process.env.MESSHALL_PORT) : DEFAULT_PORT;
  const session = `messhall-codex-${port}`;
  const other = as === 'api' ? 'web' : 'api';
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
    console.error(dim(line));
  };

  const daemon = await spawnDaemon({ detached: keep, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  const key = readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();
  // Held for the whole run: Codex drops a thread's own MCP config once no client holds the thread.
  const codex = createCodexClient({ socketPath: codexControlSocket() });

  let scripted: Awaited<ReturnType<typeof connectHttp>> | undefined;
  let threadId: string | undefined;
  let code = 1;
  let replyMs: number | undefined;
  let doorbell = 'unknown';
  try {
    await run('codex', ['app-server', 'daemon', 'start'], tmpdir());
    // A new folder asks for trust and saving it writes config.toml. Home is trusted, so it runs there read-only.
    const started = await codex.request('thread/start', {
      approvalPolicy: 'on-request',
      config: {
        [`mcp_servers.${SERVER_NAME}.default_tools_approval_mode`]: 'approve',
        [`mcp_servers.${SERVER_NAME}.http_headers`]: { [KEY_HEADER_NAME]: key },
        [`mcp_servers.${SERVER_NAME}.url`]: `${daemon.url}/mcp`,
      },
      cwd: homedir(),
      model: MODEL,
      sandbox: 'read-only',
    });
    if (!started.ok) throw new Error(`codex thread/start failed: ${started.error}`);
    threadId = started.result.thread.id;
    const seeded = await codex.request('thread/inject_items', {
      items: [{ content: [{ text: SEED, type: 'output_text' }], role: 'assistant', type: 'message' }],
      threadId,
    });
    if (!seeded.ok) throw new Error(`codex thread/inject_items failed: ${seeded.error}`);
    note(`codex thread ${threadId} started with messhall on ${daemon.url}`);

    await tmux(['kill-session', '-t', session]);
    const tui = `codex resume ${threadId} --no-alt-screen`;
    const opened = await tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50', '-c', homedir(), tui]);
    if (opened.code !== 0) throw new Error(`tmux new-session failed: ${opened.stderr.trim()}`);
    note(`codex tui started in tmux session ${session}`);

    // A dialog can open after the composer shows, and Enter there runs brew upgrade, so ready must hold twice.
    let seen: Screen = 'loading';
    const ready = await until(Date.now() + READY_WITHIN_MS, async () => {
      const screen = codexScreen(await pane(session));
      if (screen === 'update') {
        note('skipping the codex update prompt');
        await tmux(['send-keys', '-t', session, 'Escape']);
      }
      const settled = screen === seen && screen !== 'loading' && screen !== 'update' ? screen : undefined;
      seen = screen;
      return settled;
    });
    if (ready !== 'ready') throw new Error(`codex tui is not ready: ${ready ?? 'nothing within 60 s'}`);
    const loaded = await codex.request('thread/loaded/list', {});
    if (!loaded.ok || !loaded.result.data.includes(threadId)) {
      throw new Error('the thread is not loaded on the codex daemon');
    }
    const servers = await codex.request('mcpServerStatus/list', { serverName: SERVER_NAME, threadId });
    const connected = servers.ok && servers.result.data.some(server => server.runtimeStatus === 'connected');
    if (!connected) throw new Error(`messhall is not a connected MCP server on the thread, see codex logs`);
    note('codex tui is on the shared daemon, the thread is loaded with messhall connected');

    const prompt = `Run echo $CODEX_THREAD_ID. Then call messhall join: room ${room}, as ${as}, thread_id that value. Do not call wait. When a messhall line arrives, call read_since and answer the mention in one short post.`;
    await tmux(['send-keys', '-t', session, '-l', prompt]);
    await sleep(POLL_MS);
    // The typed prompt hides the composer hint, so only a dialog stops us here.
    const before = codexScreen(await pane(session));
    if (before === 'update' || before === 'trust') throw new Error('a codex dialog opened, stopped before enter');
    await tmux(['send-keys', '-t', session, 'Enter']);

    scripted = await connectHttp({ key, name: 'messhall-dev-agent', url: daemon.url });
    let { client } = scripted;
    const joined = await until(Date.now() + JOIN_WITHIN_MS, async () => {
      const list = textOf(await client.callTool({ arguments: { room }, name: 'list_members' }));
      const state = memberStatus({ list, name: as });
      return state && state.presence !== 'waiting' && Date.now() - state.lastSeen > QUIET_MS ? state : undefined;
    });
    if (!joined) throw new Error(`${as} never joined #${room} and settled within ${JOIN_WITHIN_MS / 1000} s`);
    doorbell = joined.doorbell ? 'codex' : 'none';
    if (!joined.doorbell) throw new Error(`${as} joined #${room} without a working thread id, so it has no doorbell`);
    note(`${as} joined #${room} with the codex doorbell and is quiet`);
    if (quiet) {
      // This scripted session holds no stream either, so it ends before the quiet and opens again after.
      await scripted.transport.terminateSession().catch(() => {});
      await scripted.client.close();
      await sleep(quiet * 1000);
      scripted = await connectHttp({ key, name: 'messhall-dev-agent', url: daemon.url });
      ({ client } = scripted);
      const list = textOf(await client.callTool({ arguments: { room }, name: 'list_members' }));
      note(`after ${quiet} s quiet, ${as} is ${memberStatus({ list, name: as })?.presence ?? 'not in the room'}`);
    }

    await client.callTool({ arguments: { as: other, room }, name: 'join' });
    const postedAt = Date.now();
    await client.callTool({ arguments: { room, text: `@${as} what is 2 + 2? reply here in one line.` }, name: 'post' });
    note(`${other} posted the mention`);
    const waited = await client.callTool(
      { arguments: { room, timeout_s: REPLY_WITHIN_S }, name: 'wait' },
      { resetTimeoutOnProgress: true, timeout: (REPLY_WITHIN_S + 10) * 1000 },
    );
    if (waited.isError || textOf(waited) === NOTHING_YET) {
      throw new Error(`no reply from ${as} within ${REPLY_WITHIN_S} s`);
    }
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

  const screen = (await pane(session))
    .split('\n')
    .filter(line => line.trim())
    .slice(-PANE_LINES);
  const transcript = roomReport({ dataDir: home, name: room });
  const report = [
    ...lines,
    '',
    dim('codex pane:'),
    ...screen,
    '',
    transcript.report,
    '',
    formatTable(
      ['codex', ''],
      [
        ['room', `#${room}`],
        ['codex as', as],
        ['thread', threadId ?? 'none'],
        ['doorbell', doorbell],
        ['post to reply', replyMs === undefined ? 'no reply' : `${(replyMs / 1000).toFixed(1)} s`],
      ],
    ),
    '',
    code === 0 ? ok(`${as} got the queued ring and replied`) : bad(`${as} did not reply`),
  ];

  if (keep) {
    // The open codex socket keeps this process up, which keeps the thread's messhall config alive.
    report.push(dim(`left running: tmux attach -t ${session}, daemon pid ${daemon.child.pid}. ctrl-c here ends it`));
    daemon.child.unref();
    return { code, report: report.join('\n') };
  }
  await tmux(['kill-session', '-t', session]);
  if (threadId) await codex.request('thread/archive', { threadId });
  codex.close();
  await daemon.stop();
  if (ownHome) rmSync(home, { force: true, recursive: true });
  return { code, report: report.join('\n') };
}

/** Registers `codex --room <r> [--as <role>] [--quiet <s>] [--keep]`. */
export function registerCodex(program: Command) {
  program
    .command('codex')
    .description('A real Codex TUI on the shared app-server daemon: a mention queues a ring, it reads and replies.')
    .requiredOption('--room <room>', 'room to join')
    .option('--as <role>', 'the role codex joins as', 'api')
    .option('--quiet <s>', 'sit idle this long after the join before the mention', value => Number(value))
    .option('--keep', 'leave tmux, the thread and the daemon running')
    .action(async (options: { as: string; keep?: boolean; quiet?: number; room: string }) => {
      const result = await codexRun({ ...options, keep: Boolean(options.keep) });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
