import type { KnownSeat, RunningSources } from '../../src/running/running.js';

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

const seat = (overrides: Partial<KnownSeat> = {}): KnownSeat => ({
  cwd: null,
  kind: 'claude',
  name: 'api',
  pid: null,
  room: 'dev',
  threadId: null,
  tmux: null,
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
        pid: 101,
        reach: 'claude_session',
        repo: 'api',
        room: null,
        seats: [],
        status: 'idle',
        tmux: null,
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
        seats: [seat({ kind: 'codex', threadId: 't-1' })],
      }),
    );

    expect(found[0]?.room).toBe('dev');
  });

  it('marks the room of a claude a spawned seat runs in that folder', async () => {
    const found = await runningAgents(sources({ seats: [seat({ cwd: '/code/api' })] }));

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

  it('names every seat a session holds by its pid, with the tmux session of a spawned one', async () => {
    const found = await runningAgents(
      sources({
        claude: [
          { cwd: '/code/api', id: 's-1', pid: 101, status: 'idle' },
          { cwd: '/code/api', id: 's-2', pid: 102, status: 'busy' },
        ],
        seats: [
          seat({ name: 'reviewer', pid: 102, room: 'qa', tmux: 'messhall_qa_reviewer' }),
          seat({ name: 'api', pid: 101, room: 'dev' }),
          seat({ name: 'api', pid: 101, room: 'checkout' }),
          seat({ name: 'api', pid: 101, room: 'dev' }),
        ],
      }),
    );

    expect(found.map(({ id, room, seats, tmux }) => ({ id, room, seats, tmux }))).toStrictEqual([
      {
        id: 's-1',
        room: 'checkout',
        seats: [
          { name: 'api', room: 'checkout' },
          { name: 'api', room: 'dev' },
        ],
        tmux: null,
      },
      { id: 's-2', room: 'qa', seats: [{ name: 'reviewer', room: 'qa' }], tmux: 'messhall_qa_reviewer' },
    ]);
  });

  it('never gives a seat with a pid to another session in the same folder', async () => {
    const found = await runningAgents(sources({ seats: [seat({ cwd: '/code/api', pid: 999 })] }));

    expect(found[0]?.seats).toStrictEqual([]);
  });

  it('gives a codex thread the pid of the codex tui in its folder when they are the only pair there', async () => {
    const found = await runningAgents(
      sources({
        claude: [],
        codexPids: new Map([
          [401, '/code/web'],
          [402, '/code/docs'],
          [403, '/code/docs'],
        ]),
        codexThreads: [
          { cwd: '/code/web', id: 't-1', status: 'busy' },
          { cwd: '/code/api', id: 't-2', status: 'idle' },
          { cwd: '/code/api', id: 't-3', status: 'idle' },
          { cwd: '/code/docs', id: 't-4', status: 'idle' },
        ],
      }),
    );

    expect(found.map(({ id, pid }) => ({ id, pid }))).toStrictEqual([
      { id: 't-1', pid: 401 },
      { id: 't-2', pid: null },
      { id: 't-3', pid: null },
      { id: 't-4', pid: null },
    ]);
  });
});
