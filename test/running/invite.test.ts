import type { Deliver } from '../../src/running/invite.js';
import type { ScannedAgent } from '../../src/running/running.js';

import { describe, expect, it } from 'vitest';

import { inviteRunning, joinLine } from '../../src/running/invite.js';

const agent = (overrides: Partial<ScannedAgent> = {}): ScannedAgent => ({
  branch: 'rm-7/api',
  cwd: '/code/api',
  id: 's-1',
  kind: 'claude',
  pid: 101,
  reach: 'copy_only',
  repo: 'api',
  room: null,
  seats: [],
  status: 'idle',
  target: null,
  tmux: null,
  ...overrides,
});

const thread = agent({ cwd: '/code/web', id: 't-1', kind: 'codex', reach: 'codex_thread', repo: 'web' });
const channel = agent({ reach: 'claude_channel', target: 'mcp-1' });
const pane = agent({ reach: 'tmux_pane', target: '%3' });

const deliver = (overrides: Partial<Deliver> = {}): Deliver => ({
  queue: () => Promise.resolve(true),
  ring: () => Promise.resolve(true),
  type: () => Promise.resolve('sent'),
  ...overrides,
});
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
  it('queues the line on a codex thread and hands back a copy line for an agent it cannot reach', async () => {
    const queued: [string, string][] = [];

    const result = await inviteRunning({
      agents: [agent(), thread, plain],
      deliver: deliver({
        queue: (threadId, text) => {
          queued.push([threadId, text]);
          return Promise.resolve(true);
        },
      }),
      ids: ['s-1', 't-1', 'pid-9'],
      room: 'rm-7',
    });

    expect(queued).toStrictEqual([['t-1', joinLine({ agent: thread, name: 'web', room: 'rm-7' })]]);
    expect(result.map(({ id, name, outcome, why }) => ({ id, name, outcome, why }))).toStrictEqual([
      {
        id: 's-1',
        name: 'api',
        outcome: 'copy',
        why: 'started outside messhall, start it with messhall claude next time',
      },
      { id: 't-1', name: 'web', outcome: 'queued', why: null },
      {
        id: 'pid-9',
        name: 'docs',
        outcome: 'copy',
        why: 'started outside messhall, start it with messhall codex next time',
      },
    ]);
  });

  it('rings a claude messhall started on its channel', async () => {
    const rung: [string, string][] = [];

    const [result] = await inviteRunning({
      agents: [channel],
      deliver: deliver({
        ring: (session, text) => {
          rung.push([session, text]);
          return Promise.resolve(true);
        },
      }),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(rung).toStrictEqual([['mcp-1', joinLine({ agent: channel, name: 'api', room: 'rm-7' })]]);
    expect(result).toMatchObject({ outcome: 'sent', why: null });
  });

  it('falls back to a copy line when the channel is gone', async () => {
    const [result] = await inviteRunning({
      agents: [channel],
      deliver: deliver({ ring: () => Promise.resolve(false) }),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(result).toMatchObject({ outcome: 'copy', why: 'its messhall channel closed, so nothing was sent' });
  });

  it('types the line into the tmux pane of an idle claude', async () => {
    const typed: [string, string][] = [];

    const [result] = await inviteRunning({
      agents: [pane],
      deliver: deliver({
        type: (target, text) => {
          typed.push([target, text]);
          return Promise.resolve('sent');
        },
      }),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(typed).toStrictEqual([['%3', joinLine({ agent: pane, name: 'api', room: 'rm-7' })]]);
    expect(result).toMatchObject({ outcome: 'sent', why: null });
  });

  it('never types into the pane of a busy claude', async () => {
    const typed: string[] = [];

    const [result] = await inviteRunning({
      agents: [agent({ reach: 'tmux_pane', status: 'busy', target: '%3' })],
      deliver: deliver({
        type: target => {
          typed.push(target);
          return Promise.resolve('sent');
        },
      }),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(typed).toStrictEqual([]);
    expect(result).toMatchObject({ outcome: 'copy', why: 'it was busy in its tmux pane, so nothing was typed' });
  });

  it.each([
    ['draft', 'its tmux pane had a draft in the input box, so nothing was typed'],
    ['menu', 'its tmux pane had a menu open, so nothing was typed'],
    ['not_ready', 'its tmux pane did not show claude at its prompt, so nothing was typed'],
    ['stuck', 'the line sits in the input box of its tmux pane, press enter there'],
  ] as const)('hands back a copy line when the pane gives %s', async (typed, why) => {
    const [result] = await inviteRunning({
      agents: [pane],
      deliver: deliver({ type: () => Promise.resolve(typed) }),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(result).toMatchObject({ outcome: 'copy', why });
  });

  it('falls back to a copy line when the thread refuses the queue', async () => {
    const [result] = await inviteRunning({
      agents: [thread],
      deliver: deliver({ queue: () => Promise.resolve(false) }),
      ids: ['t-1'],
      room: 'rm-7',
    });

    expect(result).toMatchObject({ outcome: 'copy', why: 'its codex thread refused the line' });
  });

  it('reports an id that no longer runs as gone', async () => {
    const result = await inviteRunning({ agents: [], deliver: deliver(), ids: ['s-9'], room: 'rm-7' });

    expect(result).toStrictEqual([{ id: 's-9', line: null, name: null, outcome: 'gone', why: null }]);
  });

  it('gives two agents from one repo different names', async () => {
    const result = await inviteRunning({
      agents: [agent(), agent({ id: 's-2' })],
      deliver: deliver(),
      ids: ['s-1', 's-2'],
      room: 'rm-7',
    });

    expect(result.map(invite => invite.name)).toStrictEqual(['api', 'api-2']);
  });

  it('names an agent agent when its folder makes no name', async () => {
    const [result] = await inviteRunning({
      agents: [agent({ cwd: '/Users/me/日本', repo: null })],
      deliver: deliver(),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(result?.name).toBe('agent');
  });

  it('names an agent outside a repo by its folder', async () => {
    const [result] = await inviteRunning({
      agents: [agent({ cwd: '/Users/me/My Notes', repo: null })],
      deliver: deliver(),
      ids: ['s-1'],
      room: 'rm-7',
    });

    expect(result?.name).toBe('my-notes');
  });
});
