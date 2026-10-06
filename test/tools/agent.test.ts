import type { Daemon } from '../../src/daemon/server.js';

import { mkdtempSync, rmSync } from 'node:fs';
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

  it('stays in the room while it waits, and ends gone', async () => {
    const waiting = agentRun({
      keyFile: keyFile(),
      role: 'web',
      room: 'checkout',
      timeout: 1,
      url: daemon.url,
      wait: true,
    });

    const result = await waiting;

    expect(stripVTControlCharacters(result.report)).not.toContain('left #checkout.');
    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toContain('web is gone');
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

  it('sends the client name it was given at initialize', async () => {
    await agentRun({ client: 'claude-code', keyFile: keyFile(), role: 'api', room: 'checkout', url: daemon.url });

    expect(stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report)).toMatch(/api +claude /);
  });

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
