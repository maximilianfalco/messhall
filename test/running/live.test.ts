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
      channels: () => Promise.resolve(new Map()),
      claudeDir: claudeDir(),
      codex: down,
      plainCodex: true,
      run: runner(calls),
      seats: () => Promise.resolve([]),
      tmux: null,
    });

    const running = await scan();

    expect(running.agents.map(({ id, reach, repo }) => ({ id, reach, repo }))).toStrictEqual([
      { id: 's-101', reach: 'copy_only', repo: 'api' },
      { id: 's-102', reach: 'copy_only', repo: 'web' },
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
      channels: () => Promise.resolve(new Map()),
      claudeDir: '/nowhere',
      codex: down,
      plainCodex: true,
      run,
      seats: () => Promise.resolve([]),
      tmux: null,
    });

    await expect(scan()).resolves.toStrictEqual({ agents: [], suggestions: [] });
    expect(calls.map(call => call[0])).toStrictEqual(['ps']);
  });
});

describe('createRunningScan reach', () => {
  const scan = (overrides: Partial<Parameters<typeof createRunningScan>[0]> = {}) =>
    createRunningScan({
      alive: () => true,
      channels: () => Promise.resolve(new Map()),
      claudeDir: claudeDir(),
      codex: down,
      plainCodex: false,
      run: (command, args) =>
        Promise.resolve(
          command === 'ps'
            ? ok('  101   501\n  102     1\n')
            : ok(`${args[1] ?? ''}/.git\nrm-7/${path.basename(args[1] ?? '')}\n`),
        ),
      seats: () => Promise.resolve([]),
      tmux: null,
      ...overrides,
    })();

  it('finds the tmux pane each claude runs in', async () => {
    const asked: string[][] = [];
    const running = await scan({
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

  it('skips ps when tmux has no panes', async () => {
    const calls: string[] = [];
    await scan({
      run: command => {
        calls.push(command);
        return Promise.resolve(ok(''));
      },
      tmux: () => Promise.resolve({ code: 1, stderr: 'no server running', stdout: '' }),
    });

    expect(calls).not.toContain('ps');
  });

  it('rings a claude messhall started on its channel', async () => {
    const running = await scan({ channels: () => Promise.resolve(new Map([[102, 'mcp-1']])) });

    expect(running.agents.map(({ reach, target }) => ({ reach, target }))).toStrictEqual([
      { reach: 'copy_only', target: null },
      { reach: 'claude_channel', target: 'mcp-1' },
    ]);
  });

  it('shows the list without where each invite goes', async () => {
    const running = shownRunning(await scan({ channels: () => Promise.resolve(new Map([[102, 'mcp-1']])) }));

    expect(running.agents.map(agent => Object.keys(agent).includes('target'))).toStrictEqual([false, false]);
  });
});

describe('createRunningScan on a scratch daemon', () => {
  it('never runs ps when plain codex is off', async () => {
    const calls: string[][] = [];
    const scan = createRunningScan({
      alive: () => true,
      channels: () => Promise.resolve(new Map()),
      claudeDir: claudeDir(),
      codex: down,
      plainCodex: false,
      run: runner(calls),
      seats: () => Promise.resolve([]),
      tmux: null,
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
      return Promise.resolve(ok('p101\nf12\nn127.0.0.1:51001->127.0.0.1:7707\n'));
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
    expect(calls).toStrictEqual([['lsof', '-b', '-w', '-nP', '-iTCP:7707', '-sTCP:ESTABLISHED', '-Fpn']]);
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

describe('channelSessions', () => {
  it('gives each session messhall started the pid behind its open socket', async () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return Promise.resolve(ok('p101\nf12\nn127.0.0.1:51001->127.0.0.1:7707\n'));
    };

    const found = await channelSessions({
      peers: () => [
        { id: 'mcp-1', ports: [51001] },
        { id: 'mcp-2', ports: [51009] },
      ],
      port: 7707,
      run,
    });

    expect(found).toStrictEqual(new Map([[101, 'mcp-1']]));
    expect(calls).toStrictEqual([['lsof', '-b', '-w', '-nP', '-iTCP:7707', '-sTCP:ESTABLISHED', '-Fpn']]);
  });

  it('skips lsof when no session can take a channel ring', async () => {
    const calls: string[] = [];
    const run = (command: string) => {
      calls.push(command);
      return Promise.resolve(ok(''));
    };

    await expect(channelSessions({ peers: () => [], port: 7707, run })).resolves.toStrictEqual(new Map());
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
