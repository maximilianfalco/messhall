import type { Command } from 'commander';

import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';

import { DB_FILE, DOORBELL_CHECK_MS } from '../../../src/config.js';
import { KEY_FILES } from '../../../src/daemon/keys.js';
import { typePrompt, untypedLine, until } from '../../../src/flock/tmux.js';
import { SERVER_NAME } from '../../../src/mcp/constants.js';
import { connectHttp } from '../../../src/mcp/testing.js';
import { NOTHING_YET } from '../../../src/mcp/tools/wait.js';
import { claudeArgv, launchClaude, pane, readText, tmux, writeMcpConfig } from '../lib/claudeTmux.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';

import { spawnDaemon } from './daemon.js';
import { roomReport } from './room.js';

const DEFAULT_PORT = 7797;
const JOIN_WITHIN_MS = 90_000;
const REPLY_WITHIN_S = 90;
// The doorbell skips a member active in the last 5 s, so the mention waits for it to settle.
const QUIET_MS = 6000;
const PANE_LINES = 16;
const NO_DOORBELL = '(no doorbell)';
const DOORBELL_OK = `MCP server "${SERVER_NAME}": Calling MCP tool: doorbell_ok`;

interface ChannelOptions {
  as: string;
  keep: boolean;
  plain: boolean;
  quiet?: number;
  restart: boolean;
  room: string;
}

/** The debug log lines that prove the channel registered, the bell landed and the tools ran. */
export function proofLines(log: string) {
  const ours = `MCP server "${SERVER_NAME}"`;
  return log
    .split('\n')
    .filter(line => line.includes(ours))
    .filter(line =>
      /Channel notifications registered|notifications\/claude\/channel|doorbell_ok|read_since|"post"|: post\b/.test(
        line,
      ),
    );
}

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

// The member's list_members line as a scripted agent sees it.
async function memberLine(
  scripted: Awaited<ReturnType<typeof connectHttp>>,
  { as, room }: { as: string; room: string },
) {
  const listed = await scripted.client.callTool({ arguments: { room }, name: 'list_members' });
  const text = listed.content.map(block => (block.type === 'text' ? block.text : '')).join('');
  return text.split('\n').find(line => line.startsWith(`- ${as} (`)) ?? '';
}

// A scripted mention, then how long until the reply lands.
async function mentionAndWait(
  scripted: Awaited<ReturnType<typeof connectHttp>>,
  { as, room }: { as: string; room: string },
) {
  const postedAt = Date.now();
  await scripted.client.callTool({
    arguments: { room, text: `@${as} what is 2 + 2? reply here in one line.` },
    name: 'post',
  });
  const waited = await scripted.client.callTool(
    { arguments: { room, timeout_s: REPLY_WITHIN_S }, name: 'wait' },
    { resetTimeoutOnProgress: true, timeout: (REPLY_WITHIN_S + 10) * 1000 },
  );
  const waitText = waited.content.map(block => (block.type === 'text' ? block.text : '')).join('');
  if (waited.isError || waitText === NOTHING_YET) throw new Error(`no reply from ${as} within ${REPLY_WITHIN_S} s`);
  return Date.now() - postedAt;
}

/**
 * Drives a real Claude Code in tmux with messhall as a dev channel: it joins, a scripted agent
 * mentions it, and the doorbell should make it read and reply. `restart` restarts the daemon while it
 * idles, to show whether the bell still reaches it. `plain` starts it without the channel and expects
 * it to read no doorbell once its check times out. Cleans up unless `keep`.
 */
export async function channelRun({ as, keep, plain, quiet, restart, room }: ChannelOptions) {
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

  let daemon = await spawnDaemon({ detached: keep, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  const key = readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();
  const mcpConfig = path.join(home, 'channel-mcp.json');
  writeMcpConfig({ file: mcpConfig, key, seat: randomUUID(), url: daemon.url });

  let scripted: Awaited<ReturnType<typeof connectHttp>> | undefined;
  let code = 1;
  let replyMs: number | undefined;
  let doorbell = '';
  try {
    const argv = claudeArgv({ allowedTools: [`mcp__${SERVER_NAME}`], debugFile, mcpConfig, plain });
    const ready = await launchClaude({ argv, cwd, debugFile, note, plain, session });
    if (ready !== 'registered') {
      throw new Error(ready === 'login' ? 'claude wants a login, stopped' : 'messhall never came up within 60 s');
    }
    note(plain ? 'plain claude connected, no channel' : 'channel registered');

    const prompt = `Join #${room} on messhall as ${as}, then end your turn. Do not call wait. When a messhall doorbell arrives, call read_since and reply to the mention with one short post.`;
    const typed = await typePrompt(session, prompt);
    if (typed !== 'sent') throw new Error(untypedLine(session, typed));

    const joined = await until(Date.now() + JOIN_WITHIN_MS, () => {
      const state = memberState({ home, name: as, room });
      return state && state.presence !== 'waiting' && Date.now() - state.lastSeen > QUIET_MS ? state : undefined;
    });
    if (!joined) throw new Error(`${as} never joined #${room} and settled within 90 s`);
    note(`${as} joined #${room} and is quiet`);
    if (quiet) {
      await sleep(quiet * 1000);
      note(`after ${quiet} s quiet, ${as} is ${memberState({ home, name: as, room })?.presence ?? 'not in the room'}`);
    }

    if (restart) {
      await daemon.stop();
      const again = await spawnDaemon({ detached: keep, home, port });
      if (!again.ok) throw new Error(`daemon did not come back: ${again.report}`);
      daemon = again;
      note('daemon restarted while claude idles');
      await sleep(QUIET_MS);
      note(`after the restart, ${as} is ${memberState({ home, name: as, room })?.presence ?? 'not in the room'}`);
    }

    scripted = await connectHttp({ key, name: 'messhall-dev-channel-api', url: daemon.url });
    await scripted.client.callTool({ arguments: { as: 'api', room }, name: 'join' });
    if (plain) {
      await sleep(DOORBELL_CHECK_MS);
      const line = await memberLine(scripted, { as, room });
      note(line);
      if (!line.includes(NO_DOORBELL)) throw new Error(`${as} should read ${NO_DOORBELL} after the check`);
      doorbell = 'no doorbell';
    } else {
      const acked = await until(
        Date.now() + DOORBELL_CHECK_MS,
        () => readText(debugFile).includes(DOORBELL_OK) || undefined,
      );
      if (!acked) throw new Error(`${as} never answered its doorbell check`);
      if ((await memberLine(scripted, { as, room })).includes(NO_DOORBELL)) {
        throw new Error(`${as} reads ${NO_DOORBELL} though it runs the channel`);
      }
      doorbell = 'rung';
      note(`${as} answered its doorbell check`);
      replyMs = await mentionAndWait(scripted, { as, room });
    }
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
        ['started', plain ? 'plain, no channel' : 'with the channel'],
        ['doorbell', doorbell || 'unknown'],
        ['daemon restart', restart ? 'yes, while idle' : 'no'],
        ['post to reply', replyMs === undefined ? 'no reply' : `${(replyMs / 1000).toFixed(1)} s`],
        ['debug log', debugFile],
      ],
    ),
    '',
    plain
      ? code === 0
        ? ok(`${as} reads no doorbell`)
        : bad(`${as} did not read no doorbell`)
      : code === 0
        ? ok(`${as} read the doorbell and replied`)
        : bad(`${as} did not reply`),
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

/** Registers `channel --room <r> [--as <role>] [--quiet <s>] [--keep]`. */
export function registerChannel(program: Command) {
  program
    .command('channel')
    .description('A real Claude Code in tmux on messhall as a dev channel: a mention rings it, it reads and replies.')
    .requiredOption('--room <room>', 'room to join')
    .option('--as <role>', 'the role claude joins as', 'web')
    .option('--quiet <s>', 'sit idle this long after the join before the mention', value => Number(value))
    .option('--restart', 'restart the daemon while claude idles, before the mention')
    .option('--plain', 'start claude without the channel and expect it to read no doorbell')
    .option('--keep', 'leave tmux and the daemon running')
    .action(
      async (options: {
        as: string;
        keep?: boolean;
        plain?: boolean;
        quiet?: number;
        restart?: boolean;
        room: string;
      }) => {
        const result = await channelRun({
          ...options,
          keep: Boolean(options.keep),
          plain: Boolean(options.plain),
          restart: Boolean(options.restart),
        });
        console.log(result.report);
        process.exitCode = result.code;
      },
    );
}
