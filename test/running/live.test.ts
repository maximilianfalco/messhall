import type { RunResult } from '../../src/lib/run.js';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexClient } from '../../src/codex/client.js';
import { createRunningInvite, createRunningScan, peerSeats } from '../../src/running/live.js';
import { fakeCodex, fakeTimers } from '../codex/fakeCodex.js';

const ok = (stdout: string): RunResult => ({ code: 0, stderr: '', stdout });

const claudeDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'messhall-live-'));
  const write = (pid: number, cwd: string) =>
    writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ cwd, pid, sessionId: `s-${pid}`, status: 'idle' }));
  write(101, '/code/api');
  write(102, '/code/web');
  return dir;
};

const runner = (calls: string[][]) => (command: string, args: string[]) => {
  calls.push([command, ...args]);
  if (command === 'ps') return Promise.resolve(ok('  PID ARGS\n  401 /opt/bin/codex\n  402 codex review\n'));
  if (command === 'lsof') return Promise.resolve(ok('p401\nfcwd\nn/code/docs\n'));
  const cwd = args[1] ?? '';
  return Promise.resolve(ok(`${cwd}/.git\nrm-7/${path.basename(cwd)}\n`));
};

const down = { request: () => Promise.resolve({ error: 'codex control socket closed', ok: false as const }) };

describe('createRunningScan', () => {
  it('finds every session and suggests a room for the ones on one ticket', async () => {
    const calls: string[][] = [];
    const scan = createRunningScan({
      alive: () => true,
      claudeDir: claudeDir(),
      codex: down,
      plainCodex: true,
      run: runner(calls),
      seats: () => Promise.resolve([]),
    });

    const running = await scan();

    expect(running.agents.map(({ id, reach, repo }) => ({ id, reach, repo }))).toStrictEqual([
      { id: 's-101', reach: 'claude_session', repo: 'api' },
      { id: 's-102', reach: 'claude_session', repo: 'web' },
      { id: 'pid-401', reach: 'copy_only', repo: 'docs' },
    ]);
    expect(running.suggestions).toStrictEqual([{ ids: ['s-101', 's-102', 'pid-401'], key: 'rm-7', room: 'rm-7' }]);
    expect(calls.find(call => call[0] === 'lsof')).toStrictEqual([
      'lsof',
      '-a',
      '-b',
      '-w',
      '-d',
      'cwd',
      '-Fn',
      '-p',
      '401',
    ]);
  });

  it('skips lsof when no codex runs', async () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return Promise.resolve(command === 'ps' ? ok('  PID ARGS\n  407 /opt/bin/claude\n') : ok(''));
    };
    const scan = createRunningScan({
      alive: () => true,
      claudeDir: '/nowhere',
      codex: down,
      plainCodex: true,
      run,
      seats: () => Promise.resolve([]),
    });

    await expect(scan()).resolves.toStrictEqual({ agents: [], suggestions: [] });
    expect(calls.map(call => call[0])).toStrictEqual(['ps']);
  });
});

describe('createRunningScan on a scratch daemon', () => {
  it('never runs ps when plain codex is off', async () => {
    const calls: string[][] = [];
    const scan = createRunningScan({
      alive: () => true,
      claudeDir: claudeDir(),
      codex: down,
      plainCodex: false,
      run: runner(calls),
      seats: () => Promise.resolve([]),
    });

    const running = await scan();

    expect(running.agents.map(agent => agent.id)).toStrictEqual(['s-101', 's-102']);
    expect(calls.map(call => call[0])).toStrictEqual(['git', 'git']);
  });
});

describe('peerSeats', () => {
  it('gives each seated session the pid behind its open socket', async () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return Promise.resolve(
        ok(command === 'ps' ? '  PID  PPID\n  101     1\n' : 'p101\nf12\nn127.0.0.1:51001->127.0.0.1:7707\n'),
      );
    };

    const seats = await peerSeats({
      peers: () => [
        { kind: 'claude', ports: [51001], seats: [{ name: 'api', room: 'dev' }] },
        { kind: 'codex', ports: [51009], seats: [{ name: 'web', room: 'dev' }] },
      ],
      port: 7707,
      run,
    });

    expect(seats).toStrictEqual([
      { cwd: null, kind: 'claude', name: 'api', pid: 101, room: 'dev', threadId: null, tmux: null },
    ]);
    expect(calls).toStrictEqual([
      ['lsof', '-b', '-w', '-nP', '-iTCP:7707', '-sTCP:ESTABLISHED', '-Fpn'],
      ['ps', '-axo', 'pid,ppid'],
    ]);
  });

  it('also seats the parents of the process holding the socket, since the client may be a child of the session', async () => {
    const run = (command: string) =>
      Promise.resolve(
        ok(command === 'ps' ? 'PID PPID\n300 200\n200 101\n101 1\n' : 'p300\nf12\nn127.0.0.1:51001->127.0.0.1:7707\n'),
      );

    const seats = await peerSeats({
      peers: () => [{ kind: 'claude', ports: [51001], seats: [{ name: 'api', room: 'dev' }] }],
      port: 7707,
      run,
    });

    expect(seats.map(seat => seat.pid)).toStrictEqual([300, 200, 101]);
  });

  it('skips lsof when no session is seated', async () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return Promise.resolve(ok(''));
    };

    await expect(peerSeats({ peers: () => [], port: 7707, run })).resolves.toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });
});

describe('createRunningInvite', () => {
  const thread = {
    branch: 'rm-7/web',
    cwd: '/code/web',
    id: 't-1',
    kind: 'codex' as const,
    pid: null,
    reach: 'codex_thread' as const,
    repo: 'web',
    room: null,
    seats: [],
    status: 'idle' as const,
    tmux: null,
  };

  it('scans again and queues the line on the codex thread', async () => {
    const codex = await fakeCodex({ 'thread/queue/add': () => ({ result: { queuedSubmission: {} } }) });
    const client = createCodexClient({ setTimer: fakeTimers().setTimer, socketPath: codex.socketPath });
    const invite = createRunningInvite({
      codex: client,
      scan: () => Promise.resolve({ agents: [thread], suggestions: [] }),
    });

    const result = await invite({ ids: ['t-1'], room: 'rm-7' });

    client.close();
    await codex.cleanup();
    expect(result.invites.map(found => found.outcome)).toStrictEqual(['queued']);
    expect(codex.frames.find(frame => frame.method === 'thread/queue/add')?.params).toMatchObject({
      input: [{ text: result.invites[0]?.line, type: 'text' }],
      threadId: 't-1',
    });
  });
});
