import type { Daemon } from '../../src/daemon/server.js';

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEY_FILES } from '../../src/daemon/keys.js';
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

  it('leaves after a one-shot post, so the room reads left and not gone', async () => {
    const result = await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', say: 'hello', url: daemon.url });

    const room = stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report);
    expect(stripVTControlCharacters(result.report)).toContain('left #checkout.');
    expect(stripVTControlCharacters(result.report)).toContain('session ended, api left #checkout');
    expect(room).toMatch(/system +api left/);
    expect(room).not.toContain('is gone');
  });

  it('leaves after it waits, so the room reads left and not gone', async () => {
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
    expect(room).not.toContain('is gone');
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

  it('names itself messhall-dev when no client is given', async () => {
    await agentRun({ keyFile: keyFile(), role: 'api', room: 'checkout', url: daemon.url });

    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toMatch(
      /api +other +messhall-dev /,
    );
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
    expect(room).not.toMatch(/web is gone|web reconnected/);
  });

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
    expect(room).not.toContain('web is gone');
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
