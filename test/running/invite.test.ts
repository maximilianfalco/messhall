import type { RunningAgent } from '../../contracts/feed.ts';

import { describe, expect, it } from 'vitest';

import { inviteRunning, joinLine } from '../../src/running/invite.js';

const agent = (overrides: Partial<RunningAgent> = {}): RunningAgent => ({
  branch: 'rm-7/api',
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
  ...overrides,
});

const thread = agent({ cwd: '/code/web', id: 't-1', kind: 'codex', reach: 'codex_thread', repo: 'web' });
const plain = agent({ cwd: '/code/docs', id: 'pid-9', kind: 'codex', reach: 'copy_only', repo: 'docs' });

describe('joinLine', () => {
  it('tells a codex thread its own thread id and to check with its human when mid task', () => {
    expect(joinLine({ agent: thread, name: 'web', room: 'rm-7' })).toBe(
      'The human invites you to #rm-7 in messhall. Join #rm-7 as web with the messhall tools, with thread_id set to t-1. If you are mid task, finish your step or ask your human first.',
    );
  });

  it('has a plain codex learn its thread id first', () => {
    expect(joinLine({ agent: plain, name: 'docs', room: 'rm-7' })).toBe(
      'The human invites you to #rm-7 in messhall. Run echo $CODEX_THREAD_ID, then join #rm-7 as docs with the messhall tools, with thread_id set to that value. If you are mid task, finish your step or ask your human first.',
    );
  });

  it('gives a claude the plain join', () => {
    expect(joinLine({ agent: agent(), name: 'api', room: 'rm-7' })).toBe(
      'The human invites you to #rm-7 in messhall. Join #rm-7 as api with the messhall tools. If you are mid task, finish your step or ask your human first.',
    );
  });
});

describe('inviteRunning', () => {
  it('queues the line on a codex thread and hands back a copy line for the rest', async () => {
    const queued: [string, string][] = [];

    const result = await inviteRunning({
      agents: [agent(), thread, plain],
      ids: ['s-1', 't-1', 'pid-9'],
      queue: (threadId, text) => {
        queued.push([threadId, text]);
        return Promise.resolve(true);
      },
      room: 'rm-7',
    });

    expect(queued).toStrictEqual([['t-1', joinLine({ agent: thread, name: 'web', room: 'rm-7' })]]);
    expect(result.map(({ id, name, outcome }) => ({ id, name, outcome }))).toStrictEqual([
      { id: 's-1', name: 'api', outcome: 'copy' },
      { id: 't-1', name: 'web', outcome: 'queued' },
      { id: 'pid-9', name: 'docs', outcome: 'copy' },
    ]);
  });

  it('falls back to a copy line when the thread refuses the queue', async () => {
    const [result] = await inviteRunning({
      agents: [thread],
      ids: ['t-1'],
      queue: () => Promise.resolve(false),
      room: 'rm-7',
    });

    expect(result?.outcome).toBe('copy');
  });

  it('reports an id that no longer runs as gone', async () => {
    const result = await inviteRunning({ agents: [], ids: ['s-9'], queue: () => Promise.resolve(true), room: 'rm-7' });

    expect(result).toStrictEqual([{ id: 's-9', line: null, name: null, outcome: 'gone' }]);
  });

  it('gives two agents from one repo different names', async () => {
    const result = await inviteRunning({
      agents: [agent(), agent({ id: 's-2' })],
      ids: ['s-1', 's-2'],
      queue: () => Promise.resolve(true),
      room: 'rm-7',
    });

    expect(result.map(invite => invite.name)).toStrictEqual(['api', 'api-2']);
  });

  it('names an agent agent when its folder makes no name', async () => {
    const [result] = await inviteRunning({
      agents: [agent({ cwd: '/Users/me/日本', repo: null })],
      ids: ['s-1'],
      queue: () => Promise.resolve(true),
      room: 'rm-7',
    });

    expect(result?.name).toBe('agent');
  });

  it('names an agent outside a repo by its folder', async () => {
    const [result] = await inviteRunning({
      agents: [agent({ cwd: '/Users/me/My Notes', repo: null })],
      ids: ['s-1'],
      queue: () => Promise.resolve(true),
      room: 'rm-7',
    });

    expect(result?.name).toBe('my-notes');
  });
});
