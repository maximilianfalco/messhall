import type { RunResult } from '../../src/lib/run.js';
import type { ThreadStatus } from '../../src/codex/generated/v2/ThreadStatus.js';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexClient } from '../../src/codex/client.js';
import { codexProcesses, cwdsFromLsof, gitPlace, readClaudeSessions, readCodexThreads } from '../../src/running/scan.js';
import { fakeCodex, fakeTimers } from '../codex/fakeCodex.js';

const sessionsDir = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'messhall-sessions-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
};

const session = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ cwd: '/code/api', kind: 'interactive', pid: 101, sessionId: 's-101', status: 'idle', ...overrides });

describe('readClaudeSessions', () => {
  it('reads each live session with its folder and idle or busy', () => {
    const dir = sessionsDir({
      '101.json': session(),
      '102.json': session({ cwd: '/code/web', pid: 102, sessionId: 's-102', status: 'busy' }),
    });

    expect(readClaudeSessions({ alive: () => true, dir })).toStrictEqual([
      { cwd: '/code/api', id: 's-101', pid: 101, status: 'idle' },
      { cwd: '/code/web', id: 's-102', pid: 102, status: 'busy' },
    ]);
  });

  it('skips a session whose process is gone', () => {
    const dir = sessionsDir({ '101.json': session(), '102.json': session({ pid: 102, sessionId: 's-102' }) });

    expect(readClaudeSessions({ alive: pid => pid === 102, dir }).map(found => found.id)).toStrictEqual(['s-102']);
  });

  it('skips files that are not session json and never opens key files', () => {
    const dir = sessionsDir({ '101.abc.key': 'secret', '103.json': '{nope', 'notes.txt': 'x', '101.json': session() });

    expect(readClaudeSessions({ alive: () => true, dir }).map(found => found.id)).toStrictEqual(['s-101']);
  });

  it('reads an unknown status as unknown', () => {
    const dir = sessionsDir({ '101.json': session({ status: 'waking' }) });

    expect(readClaudeSessions({ alive: () => true, dir })[0]?.status).toBe('unknown');
  });

  it('returns nothing when the folder is missing', () => {
    expect(readClaudeSessions({ alive: () => true, dir: '/nowhere/sessions' })).toStrictEqual([]);
  });
});

describe('gitPlace', () => {
  const ok = (stdout: string): RunResult => ({ code: 0, stderr: '', stdout });

  it('names the main repo folder for a worktree, and the branch', async () => {
    const run = async () => ok('/code/messhall/.git\nf10/invite-running\n');

    expect(await gitPlace({ cwd: '/code/messhall/.worktrees/f10', run })).toStrictEqual({
      branch: 'f10/invite-running',
      repo: 'messhall',
    });
  });

  it('gives no branch on a detached head', async () => {
    const run = async () => ok('/code/api/.git\nHEAD\n');

    expect(await gitPlace({ cwd: '/code/api', run })).toStrictEqual({ branch: null, repo: 'api' });
  });

  it('gives nothing outside a repo', async () => {
    const run = async (): Promise<RunResult> => ({ code: 128, stderr: 'not a git repository', stdout: '' });

    expect(await gitPlace({ cwd: '/tmp', run })).toStrictEqual({ branch: null, repo: null });
  });
});

describe('codexProcesses', () => {
  it('keeps codex sessions and drops servers and workers', () => {
    const ps = [
      '  401 /opt/bin/codex codex',
      '  402 /opt/bin/codex codex resume 019a',
      '  403 /opt/bin/codex codex app-server',
      '  404 /opt/bin/codex codex exec fix it',
      '  405 /opt/bin/codex /x/bin/codex app-server daemon',
      '  406 /usr/bin/node node /x/codex.js',
      '  407 /opt/bin/claude claude',
    ].join('\n');

    expect(codexProcesses(ps)).toStrictEqual([401, 402]);
  });
});

describe('cwdsFromLsof', () => {
  it('maps each pid to its folder', () => {
    expect(cwdsFromLsof('p401\nfcwd\nn/code/api\np402\nfcwd\nn/code/web\n')).toStrictEqual(
      new Map([
        [401, '/code/api'],
        [402, '/code/web'],
      ]),
    );
  });
});

describe('readCodexThreads', () => {
  const threads: Record<string, { cwd: string; status: ThreadStatus }> = {
    t1: { cwd: '/code/api', status: { activeFlags: [], type: 'active' } },
    t2: { cwd: '/code/web', status: { type: 'idle' } },
  };

  const reader = async (answers: Parameters<typeof fakeCodex>[0]) => {
    const codex = await fakeCodex(answers);
    const client = createCodexClient({ setTimer: fakeTimers().setTimer, socketPath: codex.socketPath });
    const found = await readCodexThreads({ codex: client });
    client.close();
    await codex.cleanup();
    return { found, frames: codex.frames };
  };

  it('lists each loaded thread with its folder and idle or busy, without its turns', async () => {
    const { found, frames } = await reader({
      'thread/loaded/list': () => ({ result: { data: Object.keys(threads), nextCursor: null } }),
      'thread/read': params => {
        const { threadId } = params as { threadId: string };
        return { result: { thread: { id: threadId, ...threads[threadId] } } };
      },
    });

    expect(found).toStrictEqual([
      { cwd: '/code/api', id: 't1', status: 'busy' },
      { cwd: '/code/web', id: 't2', status: 'idle' },
    ]);
    expect(frames.filter(frame => frame.method === 'thread/read').map(frame => frame.params)).toStrictEqual([
      { includeTurns: false, threadId: 't1' },
      { includeTurns: false, threadId: 't2' },
    ]);
  });

  it('returns nothing when the shared server refuses the list', async () => {
    const { found } = await reader({ 'thread/loaded/list': () => ({ error: 'no' }) });

    expect(found).toStrictEqual([]);
  });
});
