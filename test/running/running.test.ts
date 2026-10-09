import type { RunningSources } from '../../src/running/running.js';

import { describe, expect, it } from 'vitest';

import { runningAgents } from '../../src/running/running.js';

const sources = (overrides: Partial<RunningSources> = {}): RunningSources => ({
  claude: [{ cwd: '/code/api', id: 's-1', pid: 101, status: 'idle' }],
  codexPids: new Map(),
  codexThreads: [],
  place: cwd => Promise.resolve({ branch: 'rm-1/x', repo: cwd.split('/').at(-1) ?? null }),
  seats: [],
  ...overrides,
});

describe('runningAgents', () => {
  it('lists claude sessions as reachable by session messaging', async () => {
    await expect(runningAgents(sources())).resolves.toStrictEqual([
      {
        branch: 'rm-1/x',
        cwd: '/code/api',
        id: 's-1',
        kind: 'claude',
        reach: 'claude_session',
        repo: 'api',
        room: null,
        status: 'idle',
      },
    ]);
  });

  it('lists a codex on the shared server by thread, and a plain codex by pid', async () => {
    const found = await runningAgents(
      sources({
        claude: [],
        codexPids: new Map([
          [401, '/code/web'],
          [402, '/code/docs'],
        ]),
        codexThreads: [{ cwd: '/code/web', id: 't-1', status: 'busy' }],
      }),
    );

    expect(found.map(({ id, reach }) => ({ id, reach }))).toStrictEqual([
      { id: 't-1', reach: 'codex_thread' },
      { id: 'pid-402', reach: 'copy_only' },
    ]);
  });

  it('marks the room of a codex thread a seat holds', async () => {
    const found = await runningAgents(
      sources({
        claude: [],
        codexThreads: [{ cwd: '/code/web', id: 't-1', status: 'idle' }],
        seats: [{ cwd: null, kind: 'codex', room: 'dev', threadId: 't-1' }],
      }),
    );

    expect(found[0]?.room).toBe('dev');
  });

  it('marks the room of a claude a spawned seat runs in that folder', async () => {
    const found = await runningAgents(
      sources({ seats: [{ cwd: '/code/api', kind: 'claude', room: 'dev', threadId: null }] }),
    );

    expect(found[0]?.room).toBe('dev');
  });

  it('asks git once per folder', async () => {
    const asked: string[] = [];
    await runningAgents(
      sources({
        claude: [
          { cwd: '/code/api', id: 's-1', pid: 101, status: 'idle' },
          { cwd: '/code/api', id: 's-2', pid: 102, status: 'busy' },
        ],
        place: cwd => {
          asked.push(cwd);
          return Promise.resolve({ branch: null, repo: null });
        },
      }),
    );

    expect(asked).toStrictEqual(['/code/api']);
  });
});
