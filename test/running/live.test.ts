import type { RunResult } from '../../src/lib/run.js';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexClient } from '../../src/codex/client.js';
import { createRunningInvite, createRunningScan } from '../../src/running/live.js';
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

const runner = (calls: string[][]) => async (command: string, args: string[]) => {
  calls.push([command, ...args]);
  if (command === 'ps') return ok('  401 /opt/bin/codex codex\n');
  if (command === 'lsof') return ok('p401\nfcwd\nn/code/docs\n');
  const cwd = args[1] ?? '';
  return ok(`${cwd}/.git\nrm-7/${path.basename(cwd)}\n`);
};

const down = { request: async () => ({ error: 'codex control socket closed', ok: false as const }) };

describe('createRunningScan', () => {
  it('finds every session and suggests a room for the ones on one ticket', async () => {
    const calls: string[][] = [];
    const scan = createRunningScan({ alive: () => true, claudeDir: claudeDir(), codex: down, run: runner(calls), seats: async () => [] });

    const running = await scan();

    expect(running.agents.map(({ id, reach, repo }) => ({ id, reach, repo }))).toStrictEqual([
      { id: 's-101', reach: 'claude_session', repo: 'api' },
      { id: 's-102', reach: 'claude_session', repo: 'web' },
      { id: 'pid-401', reach: 'copy_only', repo: 'docs' },
    ]);
    expect(running.suggestions).toStrictEqual([{ ids: ['s-101', 's-102', 'pid-401'], key: 'rm-7', room: 'rm-7' }]);
    expect(calls.find(call => call[0] === 'lsof')).toStrictEqual(['lsof', '-a', '-d', 'cwd', '-Fn', '-p', '401']);
  });

  it('skips lsof when no codex runs', async () => {
    const calls: string[][] = [];
    const run = async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return command === 'ps' ? ok('  407 /opt/bin/claude claude\n') : ok('');
    };
    const scan = createRunningScan({ alive: () => true, claudeDir: '/nowhere', codex: down, run, seats: async () => [] });

    expect(await scan()).toStrictEqual({ agents: [], suggestions: [] });
    expect(calls.map(call => call[0])).toStrictEqual(['ps']);
  });
});

describe('createRunningInvite', () => {
  const thread = {
    branch: 'rm-7/web',
    cwd: '/code/web',
    id: 't-1',
    kind: 'codex' as const,
    reach: 'codex_thread' as const,
    repo: 'web',
    room: null,
    status: 'idle' as const,
  };

  it('scans again and queues the line on the codex thread', async () => {
    const codex = await fakeCodex({ 'thread/queue/add': () => ({ result: { queuedSubmission: {} } }) });
    const client = createCodexClient({ setTimer: fakeTimers().setTimer, socketPath: codex.socketPath });
    const invite = createRunningInvite({ codex: client, scan: async () => ({ agents: [thread], suggestions: [] }) });

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
