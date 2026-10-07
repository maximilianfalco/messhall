import type { Daemon } from '../../src/daemon/server.js';

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { agentRun } from '../../tools/dev/commands/agent.js';
import { roomReport } from '../../tools/dev/commands/room.js';

let home: string;
let daemon: Daemon;

beforeEach(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-agent-'));
  vi.stubEnv('MESSHALL_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const started = await startDaemon({ dataDir: home, now: () => new Date(), port: 0 });
  if (!started.ok) throw new Error(started.reason);
  ({ daemon } = started);
});

afterEach(async () => {
  await daemon.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

const keyFile = () => path.join(home, KEY_FILES.agent);

describe('agentRun', () => {
  it('posts the role line and sets the role when it joins as the orchestrator', async () => {
    await agentRun({ keyFile: keyFile(), role: 'reviewer-1', room: 'dev', say: 'hi', url: daemon.url });

    const result = await agentRun({
      assign: 'reviewer-1=reviewer',
      keyFile: keyFile(),
      role: 'orchestrator',
      room: 'dev',
      say: '@reviewer-1 your role: reviewer',
      url: daemon.url,
    });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toContain('reviewer-1 is now reviewer in #dev.');
    expect(text).toContain('left #dev.');
    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'dev' }).report)).toMatch(
      /reviewer-1\s+other\s+messhall-dev \S+\s+reviewer/,
    );
  });

  it('sends the instructions file with the role', async () => {
    await agentRun({ keyFile: keyFile(), role: 'reviewer-1', room: 'dev', say: 'hi', url: daemon.url });
    const file = path.join(home, 'reviewer.md');
    writeFileSync(file, 'review PRs that mention you');

    const result = await agentRun({
      assign: 'reviewer-1=reviewer',
      instructions: file,
      keyFile: keyFile(),
      role: 'orchestrator',
      room: 'dev',
      url: daemon.url,
    });

    expect(result.code).toBe(0);
    const db = new DatabaseSync(path.join(home, 'messhall.db'), { readOnly: true });
    const row = db.prepare("select role, role_instructions, role_set_by from members where name = 'reviewer-1'").get();
    db.close();
    expect({ ...row }).toStrictEqual({
      role: 'reviewer',
      role_instructions: 'review PRs that mention you',
      role_set_by: 'orchestrator',
    });
  });

  it('refuses instructions without an assign, or a missing file, before it connects', async () => {
    const base = { keyFile: keyFile(), role: 'orchestrator', room: 'dev', url: daemon.url };

    const alone = await agentRun({ ...base, instructions: path.join(home, 'reviewer.md') });
    const missing = await agentRun({ ...base, assign: 'api=reviewer', instructions: path.join(home, 'nope.md') });

    expect(stripVTControlCharacters(alone.report)).toContain('--instructions goes with --assign');
    expect(stripVTControlCharacters(missing.report)).toContain('no instructions file at');
    expect([alone.code, missing.code]).toStrictEqual([1, 1]);
  });

  it('refuses a role from a member who is not the orchestrator, and still leaves', async () => {
    const result = await agentRun({
      assign: 'api=reviewer',
      keyFile: keyFile(),
      role: 'api',
      room: 'dev',
      url: daemon.url,
    });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(1);
    expect(text).toContain('only the human or an orchestrator can set roles in #dev.');
    expect(text).toContain('left #dev.');
  });

  it('refuses an assign that is not member=role before it connects', async () => {
    const result = await agentRun({
      assign: 'reviewer',
      keyFile: keyFile(),
      role: 'orchestrator',
      room: 'dev',
      url: daemon.url,
    });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain('--assign takes <member>=<role>');
  });

  it('joins, posts and prints what came back', async () => {
    const result = await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: 'hello', url: daemon.url });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toContain('joined #checkout as api.');
    expect(text).toMatch(/posted #\d+ in #checkout\./);
  });

  it('leaves after a one-shot post, so the room reads left and not away', async () => {
    const result = await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: 'hello', url: daemon.url });

    const room = stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report);
    expect(stripVTControlCharacters(result.report)).toContain('left #checkout.');
    expect(stripVTControlCharacters(result.report)).toContain('session ended, api left #checkout');
    expect(room).toMatch(/system +api left/);
    expect(room).not.toContain('is away');
  });

  it('leaves after it waits, so the room reads left and not away', async () => {
    const result = await agentRun({
      keyFile: keyFile(),
      role: 'web',
      room: 'checkout',
      timeout: 1,
      url: daemon.url,
      wait: true,
    });

    const room = stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report);
    expect(stripVTControlCharacters(result.report)).toContain('session ended, web left #checkout');
    expect(room).toMatch(/system +web left/);
    expect(room).not.toContain('is away');
  });

  it('reads the backlog with catch-up and leaves without waiting', async () => {
    await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: 'old news', url: daemon.url });

    const result = await agentRun({
      catchUp: true,
      keyFile: keyFile(),
      role: 'web',
      room: 'checkout',
      url: daemon.url,
    });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toContain('[#2 api] old news');
    expect(text).not.toContain('wait, blocked');
    expect(text).toContain('session ended, web left #checkout');
  });

  it('blocks in wait until another agent mentions it, then reads', async () => {
    const waiting = agentRun({ keyFile: keyFile(), role: 'web', room: 'checkout', url: daemon.url, wait: true });
    await vi.waitFor(() => expect(daemon.sessionsFor({ name: 'web', room: 'checkout' })).toHaveLength(1));
    await agentRun({
      keyFile: keyFile(),
      role: 'api',
      room: 'checkout',
      say: '@web total is cents now',
      url: daemon.url,
    });

    const result = await waiting;

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toMatch(/wait, blocked \d+\.\d s/);
    expect(text).toContain('(api mentioned you). Call read_since.');
    expect(text).toContain('api → @web] @web total is cents now');
  });

  it('asks the human with buttons, then waits and reads the pick', async () => {
    const asking = agentRun({
      keyFile: keyFile(),
      option: ['ship it', 'wait'],
      question: 'merge now?',
      role: 'api',
      room: 'checkout',
      url: daemon.url,
    });
    const human = {
      'content-type': 'application/json',
      [KEY_HEADER]: readFileSync(path.join(home, KEY_FILES.human), 'utf8'),
    };
    const id = await vi.waitFor(async () => {
      const snapshot = (await (await fetch(`${daemon.url}/api/snapshot`, { headers: human })).json()) as {
        rooms: { questions: { id: string }[] }[];
      };
      const [question] = snapshot.rooms[0]?.questions ?? [];
      if (!question) throw new Error('no question yet');
      return question.id;
    });
    await vi.waitFor(() => expect(daemon.sessionsFor({ name: 'api', room: 'checkout' })).toHaveLength(1));
    await fetch(`${daemon.url}/api/questions/${id}`, {
      body: JSON.stringify({ option: 0 }),
      headers: human,
      method: 'POST',
    });

    const result = await asking;

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toContain('api ask_human');
    expect(text).toContain('(human mentioned you). Call read_since.');
    expect(text).toMatch(/human → @api\] @api answer to your question #\d+: ship it/);
  });

  it.each(['allow', 'deny'])(
    'asks to run a command like Claude Code and prints the %s it gets back',
    async behavior => {
      const asking = agentRun({ ask: 'pnpm test', keyFile: keyFile(), role: 'api', room: 'checkout', url: daemon.url });
      const human = {
        'content-type': 'application/json',
        [KEY_HEADER]: readFileSync(path.join(home, KEY_FILES.human), 'utf8'),
      };
      const id = await vi.waitFor(async () => {
        const snapshot = (await (await fetch(`${daemon.url}/api/snapshot`, { headers: human })).json()) as {
          rooms: { approvals: { id: string; input_preview: string }[] }[];
        };
        const [approval] = snapshot.rooms[0]?.approvals ?? [];
        if (!approval) throw new Error('no ask yet');
        expect(approval.input_preview).toBe('{ "command": "pnpm test" }');
        return approval.id;
      });

      await fetch(`${daemon.url}/api/approvals/${id}`, {
        body: JSON.stringify({ behavior }),
        headers: human,
        method: 'POST',
      });
      const result = await asking;

      const text = stripVTControlCharacters(result.report);
      expect(result.code).toBe(0);
      expect(text).toContain(`api ask Bash: pnpm test`);
      expect(text).toContain(`verdict ${behavior}`);
      expect(text).toContain('left #checkout.');
    },
  );

  it('says so when no verdict comes back in time', async () => {
    const result = await agentRun({
      ask: 'pnpm test',
      keyFile: keyFile(),
      role: 'api',
      room: 'checkout',
      timeout: 0.2,
      url: daemon.url,
    });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain('no verdict in 0.2 s');
  });

  it('names itself messhall-dev when no client is given', async () => {
    await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', url: daemon.url });

    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toMatch(
      /api +other +messhall-dev /,
    );
  });

  it('sends the seat key, so the same key takes the seat back and another key is refused', async () => {
    await agentRun({ keyFile: keyFile(), role: 'orchestrator', room: 'checkout', url: daemon.url });
    const following = new AbortController();
    const seated = agentRun({
      follow: true,
      keyFile: keyFile(),
      role: 'web',
      room: 'checkout',
      seat: 'seat-a',
      signal: following.signal,
      url: daemon.url,
      write: () => {},
    });
    await vi.waitFor(() => expect(daemon.sessionsFor({ name: 'web', room: 'checkout' })).toHaveLength(1));
    daemon.sessionsFor({ name: 'web', room: 'checkout' })[0]!.session.unbind('checkout');

    const stranger = await agentRun({
      keyFile: keyFile(),
      role: 'web',
      room: 'checkout',
      seat: 'seat-b',
      url: daemon.url,
    });
    const back = await agentRun({
      keyFile: keyFile(),
      role: 'web',
      room: 'checkout',
      say: 'back',
      seat: 'seat-a',
      url: daemon.url,
    });
    following.abort();
    await seated;

    expect(stripVTControlCharacters(stranger.report)).toContain('name taken, try web-2.');
    expect(back.code).toBe(0);
    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toContain('back');
  });

  it('sends the client name it was given at initialize', async () => {
    await agentRun({ client: 'claude-code', keyFile: keyFile(), role: 'api', room: 'checkout', url: daemon.url });

    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toMatch(/api +claude /);
  });

  it('follows in one session: prints each batch, posts fifo lines, leaves on stop', async () => {
    const fifo = path.join(home, 'post.fifo');
    const printed: string[] = [];
    const stop = new AbortController();
    const following = agentRun({
      follow: true,
      keyFile: keyFile(),
      postFifo: fifo,
      role: 'web',
      room: 'checkout',
      signal: stop.signal,
      url: daemon.url,
      write: line => printed.push(line),
    });
    await vi.waitFor(() => expect(daemon.sessionsFor({ name: 'web', room: 'checkout' })).toHaveLength(1));
    await vi.waitFor(() => expect(existsSync(fifo)).toBe(true));

    await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: '@web first batch', url: daemon.url });
    await vi.waitFor(() => expect(printed.join('')).toContain('@web first batch'));
    await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: '@web second batch', url: daemon.url });
    await vi.waitFor(() => expect(printed.join('')).toContain('@web second batch'));
    writeFileSync(fifo, 'from the fifo\n');
    await vi.waitFor(() =>
      expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toContain(
        'from the fifo',
      ),
    );
    stop.abort();
    const result = await following;

    const room = stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report);
    expect(result.code).toBe(0);
    expect(printed.filter(line => line.includes('batch'))).toHaveLength(2);
    expect(printed.every(line => line.endsWith('\n'))).toBe(true);
    expect(room.match(/web joined/g)).toHaveLength(1);
    expect(room).toMatch(/system +web left/);
    expect(room).not.toMatch(/web is away|web reconnected/);
  });

  async function startFollow() {
    const fifo = path.join(home, 'post.fifo');
    const printed: string[] = [];
    const stop = new AbortController();
    const pause = vi.fn<(ms: number) => Promise<void>>(async () => {
      await delay(10);
    });
    const following = agentRun({
      follow: true,
      keyFile: keyFile(),
      pause,
      postFifo: fifo,
      role: 'web',
      room: 'checkout',
      signal: stop.signal,
      url: daemon.url,
      write: line => printed.push(line),
    });
    await vi.waitFor(() => expect(daemon.sessionsFor({ name: 'web', room: 'checkout' })).toHaveLength(1));
    await vi.waitFor(() => expect(existsSync(fifo)).toBe(true));
    return { fifo, following, pause, printed, stop };
  }

  async function stillFollowing({ fifo, printed }: { fifo: string; printed: string[] }, tag: string) {
    await vi.waitFor(() => expect(printed.join('')).toMatch(/reconnected after \d+ s\n/), { timeout: 10_000 });
    await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: `@web ${tag}`, url: daemon.url });
    await vi.waitFor(() => expect(printed.join('')).toContain(`@web ${tag}`));
    writeFileSync(fifo, `fifo after ${tag}\n`);
    await vi.waitFor(() =>
      expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toContain(
        `fifo after ${tag}`,
      ),
    );
  }

  const dropSession = (id: string) =>
    new Promise<void>((resolve, reject) => {
      const req = request(
        {
          headers: { [KEY_HEADER]: readFileSync(keyFile(), 'utf8').trim(), 'mcp-session-id': id },
          host: '127.0.0.1',
          method: 'DELETE',
          path: '/mcp',
          port: daemon.port,
        },
        res => res.resume().on('end', resolve),
      );
      req.on('error', reject).end();
    });

  it('rejoins after its session is dropped and keeps reading and posting', async () => {
    const seat = await startFollow();

    await dropSession(daemon.sessionsFor({ name: 'web', room: 'checkout' })[0]!.session.id);

    await stillFollowing(seat, 'after the drop');
    seat.stop.abort();
    const result = await seat.following;
    expect(result.code).toBe(0);
    expect(seat.printed.filter(line => line.startsWith('reconnected after'))).toHaveLength(1);
    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toMatch(
      /system +web left/,
    );
  }, 20_000);

  it('waits out a daemon restart with backoff, then rejoins and keeps the fifo', async () => {
    const seat = await startFollow();
    const port = daemon.port;

    await daemon.close();
    await vi.waitFor(() => expect(seat.pause.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 });
    const restarted = await startDaemon({ dataDir: home, now: () => new Date(), port });
    if (!restarted.ok) throw new Error(restarted.reason);
    ({ daemon } = restarted);

    await stillFollowing(seat, 'after the restart');
    seat.stop.abort();
    const result = await seat.following;
    expect(result.code).toBe(0);
    expect(seat.pause.mock.calls[0]?.[0]).toBe(2000);
  }, 20_000);

  it('leaves and exits 0 when the follow process gets SIGTERM', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tools/dev/cli.ts', 'agent', 'web', '--room', 'checkout', '--follow'],
      { env: { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(new URL(daemon.url).port) } },
    );
    const exited = new Promise<number | null>(resolve => {
      child.on('exit', resolve);
    });
    await vi.waitFor(() => expect(daemon.sessionsFor({ name: 'web', room: 'checkout' })).toHaveLength(1), {
      timeout: 15_000,
    });

    child.kill('SIGTERM');

    await expect(exited).resolves.toBe(0);
    const room = stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report);
    expect(room).toMatch(/system +web left/);
    expect(room).not.toContain('web is away');
  }, 20_000);

  it('says how to start the daemon when nothing answers', async () => {
    const result = await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain('could not reach messhall at http://127.0.0.1:1');
  });

  it('says where the key should be when the key file is missing', async () => {
    const result = await agentRun({ keyFile: path.join(home, 'nope'), role: 'api', room: 'checkout', url: daemon.url });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain(`no agent key at ${path.join(home, 'nope')}`);
  });
});
