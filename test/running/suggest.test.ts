import type { RunningAgent } from '../../contracts/feed.ts';

import { describe, expect, it } from 'vitest';

import { suggestRooms, ticketKey } from '../../src/running/suggest.js';

const agent = (overrides: Partial<RunningAgent> = {}): RunningAgent => ({
  branch: 'feat/rm-1234-totals',
  cwd: '/code/api',
  id: 'claude-1',
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

describe('ticketKey', () => {
  it.each([
    ['feat/rm-1234-totals', 'rm-1234'],
    ['RM-1234/web', 'rm-1234'],
    ['f10/invite-running', null],
    ['main', null],
  ])('reads %s as %s', (branch, key) => {
    expect(ticketKey(branch)).toBe(key);
  });
});

describe('suggestRooms', () => {
  it('groups agents in different repos by the ticket key in their branch', () => {
    const agents = [
      agent({ id: 'a' }),
      agent({ branch: 'rm-1234/web', cwd: '/code/web', id: 'b', kind: 'codex', repo: 'web' }),
    ];

    expect(suggestRooms({ agents })).toStrictEqual([{ ids: ['a', 'b'], key: 'rm-1234', room: 'rm-1234' }]);
  });

  it('groups agents with no ticket key by repo and branch', () => {
    const agents = [
      agent({ branch: 'next', id: 'a' }),
      agent({ branch: 'next', id: 'b' }),
      agent({ branch: 'main', id: 'c' }),
    ];

    expect(suggestRooms({ agents })).toStrictEqual([{ ids: ['a', 'b'], key: 'api/next', room: 'api-next' }]);
  });

  it('drops a group whose key makes no room name', () => {
    const agents = [agent({ branch: '日本', id: 'a', repo: '日本' }), agent({ branch: '日本', id: 'b', repo: '日本' })];

    expect(suggestRooms({ agents })).toStrictEqual([]);
  });

  it('skips a group of one and agents outside a repo', () => {
    const agents = [agent({ id: 'a' }), agent({ branch: null, id: 'b', repo: null })];

    expect(suggestRooms({ agents })).toStrictEqual([]);
  });

  it('skips a group whose agents all sit in one room already', () => {
    const agents = [agent({ id: 'a', room: 'rm-1234' }), agent({ id: 'b', room: 'rm-1234' })];

    expect(suggestRooms({ agents })).toStrictEqual([]);
  });

  it('keeps a group when only some of it sits in a room', () => {
    const agents = [agent({ id: 'a', room: 'rm-1234' }), agent({ id: 'b' })];

    expect(suggestRooms({ agents })).toStrictEqual([{ ids: ['a', 'b'], key: 'rm-1234', room: 'rm-1234' }]);
  });
});
