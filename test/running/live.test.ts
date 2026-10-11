import type { RunResult } from '../../src/lib/run.js';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexClient } from '../../src/codex/client.js';
import {
  channelSessions,
  createRunningInvite,
  createRunningScan,
  peerSeats,
  shownRunning,
} from '../../src/running/live.js';
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

const SOCKET = 'p101\nf12\nn127.0.0.1:51001->127.0.0.1:7707\n';

const runner =
  (calls: string[][], ps = '  PID  PPID ARGS\n  401     1 /opt/bin/codex\n  402     1 codex review\n') =>
  (command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (command === 'ps') return Promise.resolve(ok(ps));
    if (command === 'lsof') return Promise.resolve(ok(args.includes('cwd') ? 'p401\nfcwd\nn/code/docs\n' : SOCKET));
    const cwd = args[1] ?? '';
    return Promise.resolve(ok(`${cwd}/.git\nrm-7/${path.basename(cwd)}\n`));
  };

const down = { request: () => Promise.resolve({ error: 'codex control socket closed', ok: false as const }) };

const noPeers = { channelPeers: () => [], peers: () => [] };

const scanWith = (overrides: Partial<Parameters<typeof createRunningScan>[0]> = {}) =>
  createRunningScan({
    alive: () => true,
    claudeDir: claudeDir(),
    codex: down,
    mcp: noPeers,
    plainCodex: false,
    port: 7707,
    run: runner([], '  PID  PPID ARGS\n  101   501 claude\n  102     1 claude\n  501     1 -zsh\n'),
    seats: () => Promise.resolve([]),
    tmux: null,
    ...overrides,
  })();

describe('createRunningScan', () => {
  it('finds every session and suggests a room for the ones on one ticket', async () => {
    const calls: string[][] = [];

    const running = await scanWith({ plainCodex: true, run: runner(calls) });

    expect(running.agents.map(({ id, reach, repo }) => ({ id, reach, repo }))).toStrictEqual([
      { id: 's-101', reach: 'copy_only', repo: 'api' },
      { id: 's-102', reach: 'copy_only', repo: 'web' },
      { id: 'pid-401', reach: 'copy_only', repo: 'docs' },
    ]);
    expect(running.suggestions).toStrictEqual([{ ids: ['s-101', 's-102', 'pid-401'], key: 'rm-7', room: 'rm-7' }]);
    expect(calls.filter(call => call[0] !== 'git')).toStrictEqual([
      ['ps', '-axo', 'pid,ppid,args'],
      ['lsof', '-a', '-b', '-w', '-d', 'cwd', '-Fn', '-p', '401'],
    ]);
  });

  it('skips lsof when no codex runs', async () => {
    const calls: string[][] = [];

    await expect(
      scanWith({
        claudeDir: '/nowhere',
        plainCodex: true,
        run: runner(calls, '  PID  PPID ARGS\n  407     1 /opt/bin/claude\n'),
      }),
    ).resolves.toStrictEqual({ agents: [], suggestions: [] });
    expect(calls.map(call => call[0])).toStrictEqual(['ps']);
  });

  it('runs ps and the socket lsof once for seats, channels, panes and codex together', async () => {
    const calls: string[][] = [];

    await scanWith({
      mcp: {
        channelPeers: () => [{ id: 'mcp-1', ports: [51001] }],
        peers: () => [{ kind: 'claude', ports: [51001], seats: [{ name: 'api', room: 'dev' }] }],
      },
      plainCodex: true,
      run: runner(calls),
      tmux: () => Promise.resolve(ok('501 %3\n')),
    });

    expect(calls.filter(call => call[0] === 'ps')).toHaveLength(1);
    expect(calls.filter(call => call[0] === 'lsof' && call.includes('-iTCP:7707'))).toHaveLength(1);
  });
});

describe('createRunningScan reach', () => {
  it('finds the tmux pane each claude runs in', async () => {
    const asked: string[][] = [];
    const running = await scanWith({
      tmux: args => {
        asked.push(args);
        return Promise.resolve(ok('501 %3\n'));
      },
    });

    expect(running.agents.map(({ id, reach, target }) => ({ id, reach, target }))).toStrictEqual([
      { id: 's-101', reach: 'tmux_pane', target: '%3' },
      { id: 's-102', reach: 'copy_only', target: null },
    ]);
    expect(asked).toStrictEqual([['list-panes', '-a', '-F', '#{pane_pid} #{pane_id}']]);
  });

  it('never gives a claude run by another agent that agent pane', async () => {
    const running = await scanWith({
      run: runner([], '  PID  PPID ARGS\n  101   300 claude\n  300   102 /bin/zsh -c claude\n  102   501 claude\n'),
      tmux: () => Promise.resolve(ok('501 %3\n')),
    });

    expect(running.agents.map(({ id, reach, target }) => ({ id, reach, target }))).toStrictEqual([
      { id: 's-101', reach: 'copy_only', target: null },
      { id: 's-102', reach: 'tmux_pane', target: '%3' },
    ]);
  });

  it('skips ps when tmux has no panes', async () => {
    const calls: string[] = [];
    await scanWith({
      run: command => {
        calls.push(command);
        return Promise.resolve(ok(''));
      },
      tmux: () => Promise.resolve({ code: 1, stderr: 'no server running', stdout: '' }),
    });

    expect(calls).not.toContain('ps');
  });

  it('rings a claude messhall started on its channel', async () => {
    const running = await scanWith({
      mcp: { channelPeers: () => [{ id: 'mcp-1', ports: [51001] }], peers: () => [] },
    });

    expect(running.agents.map(({ reach, target }) => ({ reach, target }))).toStrictEqual([
      { reach: 'claude_channel', target: 'mcp-1' },
      { reach: 'copy_only', target: null },
    ]);
  });

  it('shows the list without where each invite goes', async () => {
    const running = shownRunning(
      await scanWith({ mcp: { channelPeers: () => [{ id: 'mcp-1', ports: [51001] }], peers: () => [] } }),
    );

    expect(running.agents.map(agent => Object.keys(agent).includes('target'))).toStrictEqual([false, false]);
  });
});

describe('createRunningScan on a scratch daemon', () => {
  it('never runs ps when plain codex is off', async () => {
    const calls: string[][] = [];

    const running = await scanWith({ run: runner(calls) });

    expect(running.agents.map(agent => agent.id)).toStrictEqual(['s-101', 's-102']);
    expect(calls.map(call => call[0])).toStrictEqual(['git', 'git', 'git', 'git']);
  });
});

describe('peerSeats', () => {
  const pids = new Map([
    [51001, 300],
    [51002, 101],
  ]);
  const parents = new Map([
    [300, 200],
    [200, 101],
    [101, 1],
  ]);

  it('gives each seated session the pid behind its open socket', () => {
    const seats = peerSeats({
      parents,
      peers: [
        { kind: 'claude', ports: [51002], seats: [{ name: 'api', room: 'dev' }] },
        { kind: 'codex', ports: [51009], seats: [{ name: 'web', room: 'dev' }] },
      ],
      pids,
    });

    expect(seats).toStrictEqual([
      { cwd: null, kind: 'claude', name: 'api', parents: [], pid: 101, room: 'dev', threadId: null, tmux: null },
    ]);
  });

  it('lists the parents of the process holding the socket, nearest first', () => {
    const seats = peerSeats({
      parents,
      peers: [{ kind: 'claude', ports: [51001], seats: [{ name: 'api', room: 'dev' }] }],
      pids,
    });

    expect(seats.map(({ parents: up, pid }) => [pid, up])).toStrictEqual([[300, [200, 101]]]);
  });
});

describe('channelSessions', () => {
  it('gives each session messhall started the agent behind its open socket', () => {
    const found = channelSessions({
      agents: new Set([101]),
      parents: new Map(),
      peers: [
        { id: 'mcp-1', ports: [51001] },
        { id: 'mcp-2', ports: [51009] },
      ],
      pids: new Map([[51001, 101]]),
    });

    expect(found).toStrictEqual(new Map([[101, 'mcp-1']]));
  });

  it('walks up from a helper holding the socket to the nearest agent', () => {
    const found = channelSessions({
      agents: new Set([101]),
      parents: new Map([
        [300, 200],
        [200, 101],
        [101, 1],
      ]),
      peers: [{ id: 'mcp-1', ports: [51001] }],
      pids: new Map([[51001, 300]]),
    });

    expect(found).toStrictEqual(new Map([[101, 'mcp-1']]));
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
    target: null,
    tmux: null,
  };
  const claude = { ...thread, id: 's-1', kind: 'claude' as const };

  it('scans again and queues the line on the codex thread', async () => {
    const codex = await fakeCodex({ 'thread/queue/add': () => ({ result: { queuedSubmission: {} } }) });
    const client = createCodexClient({ setTimer: fakeTimers().setTimer, socketPath: codex.socketPath });
    const invite = createRunningInvite({
      codex: client,
      ring: () => Promise.resolve(false),
      scan: () => Promise.resolve({ agents: [thread], suggestions: [] }),
      type: () => Promise.resolve('menu'),
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

  it('rings a channel and types into a pane with the join line', async () => {
    const sent: string[][] = [];
    const invite = createRunningInvite({
      codex: down,
      ring: (session, text) => {
        sent.push(['ring', session, text]);
        return Promise.resolve(true);
      },
      scan: () =>
        Promise.resolve({
          agents: [
            { ...claude, reach: 'claude_channel', target: 'mcp-1' },
            { ...claude, id: 's-2', reach: 'tmux_pane', target: '%3' },
          ],
          suggestions: [],
        }),
      type: (pane, text) => {
        sent.push(['type', pane, text]);
        return Promise.resolve('sent');
      },
    });

    const result = await invite({ ids: ['s-1', 's-2'], room: 'rm-7' });

    expect(result.invites.map(found => found.outcome)).toStrictEqual(['sent', 'sent']);
    expect(sent).toStrictEqual([
      ['ring', 'mcp-1', result.invites[0]?.line],
      ['type', '%3', result.invites[1]?.line],
    ]);
  });
});
