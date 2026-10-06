import type { Runner } from '../../tools/dev/commands/spawn.js';
import type { launchClaude } from '../../tools/dev/lib/claudeTmux.js';
import type { RunResult } from '../../tools/dev/lib/run.js';

import { describe, expect, it, vi } from 'vitest';

import { flockStop, spawnRun } from '../../tools/dev/commands/spawn.js';
import { claudeArgv } from '../../tools/dev/lib/claudeTmux.js';
import {
  parseFlock,
  parseQueueRow,
  SPAWN_ALLOWED_TOOLS,
  spawnArgv,
  spawnPlan,
  spawnPrompt,
} from '../../tools/dev/lib/spawn.js';

const LISTING = [
  'B80  claimed  [C] branch=`f8/follow-reconnect` owner=agent 2026-10-06 15:20 f8/follow-reconnect  `agent --follow` survives a restart',
  'B81  open     [-] branch=`f8/spawn` waits on B80  `messhall-dev spawn <row>`: runs a job, waits on nothing',
  'B82  open     [A] branch=`f8/thing`  a ready job',
  'B83  done     [B] branch=`f8/old`  shipped already',
  'D80  open     [decisions]  a decision with no branch',
].join('\n');

const result = (stdout: string, code = 0): RunResult => ({ code, ms: 1, stderr: '', stdout });

describe('parseQueueRow', () => {
  it('reads status, branch, owner, blockers and job from a show --all line', () => {
    expect(parseQueueRow({ id: 'B80', listing: LISTING })).toStrictEqual({
      branch: 'f8/follow-reconnect',
      id: 'B80',
      job: '`agent --follow` survives a restart',
      owner: 'agent 2026-10-06 15:20 f8/follow-reconnect',
      status: 'claimed',
      waitsOn: [],
    });
    expect(parseQueueRow({ id: 'b81', listing: LISTING })).toMatchObject({ status: 'open', waitsOn: ['B80'] });
  });

  it('gives nothing for an unknown row', () => {
    expect(parseQueueRow({ id: 'B89', listing: LISTING })).toBeUndefined();
  });
});

describe('spawnPlan', () => {
  it.each([
    ['B81', 'B81 still waits on B80'],
    ['B80', 'B80 is claimed, not open'],
    ['B83', 'B83 is done, not open'],
    ['D80', 'D80 has no branch to build on'],
    ['B89', 'no row B89 in the queue'],
  ])('refuses %s', (id, reason) => {
    expect(spawnPlan({ id, listing: LISTING })).toStrictEqual({ ok: false, reason });
  });

  it('takes an open ready row with a branch', () => {
    expect(spawnPlan({ id: 'B82', listing: LISTING })).toMatchObject({
      ok: true,
      row: { branch: 'f8/thing', id: 'B82' },
      session: 'messhall-B82',
      slug: 'f8-thing',
    });
  });
});

describe('spawnPrompt', () => {
  const base = { branch: 'f8/thing', id: 'B82', room: 'dev', worktree: '/repo/.worktrees/f8-thing' };

  it('points at the brief, the row, the seat, the progress points and the done line', () => {
    const prompt = spawnPrompt({ ...base, brief: '/notes/brief.md' });
    expect(prompt).toContain('Read /notes/brief.md first');
    expect(prompt).toContain('row B82');
    expect(prompt).toContain('/repo/.worktrees/f8-thing');
    expect(prompt).toContain('join #dev as f8-thing');
    expect(prompt).toContain('never call leave until the row is closed');
    expect(prompt).toContain('claimed, tests green, PR open (with the url), CI result, merged');
    expect(prompt).toContain('done: true');
    expect(prompt).not.toContain('\n');
  });

  it('falls back to the pickup skill without a brief', () => {
    expect(spawnPrompt(base)).toContain('/messhall-pickup-any-work B82');
  });
});

describe('spawnArgv', () => {
  it('is the shared claude argv with the normal tools and the model', () => {
    const files = { debugFile: '/d.log', mcpConfig: '/m.json' };
    expect(spawnArgv({ ...files, model: 'opus' })).toStrictEqual([
      ...claudeArgv({ ...files, allowedTools: SPAWN_ALLOWED_TOOLS }),
      '--model',
      'opus',
    ]);
    expect(SPAWN_ALLOWED_TOOLS).toContain('Bash');
    expect(SPAWN_ALLOWED_TOOLS).toContain('mcp__messhall');
  });
});

describe('parseFlock', () => {
  it('keeps only spawn sessions, one entry per session', () => {
    const listing = [
      'messhall-B82\t%3\t4242',
      'messhall-B82\t%4\t4243',
      'messhall-demo-7792-api\t%1\t100',
      'scratch\t%0\t99',
      'messhall-D80\t%7\t777',
      '',
    ].join('\n');
    expect(parseFlock(listing)).toStrictEqual([
      { pane: '%3', pid: 4242, row: 'B82', session: 'messhall-B82' },
      { pane: '%7', pid: 777, row: 'D80', session: 'messhall-D80' },
    ]);
  });
});

describe('spawnRun', () => {
  const run = (listing: string) => {
    const queue = vi.fn<Runner>(args => Promise.resolve(result(args[0] === 'show' ? listing : 'ok')));
    const launch = vi.fn<typeof launchClaude>();
    return { launch, queue };
  };
  const options = { brief: undefined, dataDir: '/nowhere', model: 'opus', room: 'dev', url: 'http://127.0.0.1:1' };

  it('refuses a blocked row before claiming or launching anything', async () => {
    const { launch, queue } = run(LISTING);
    const outcome = await spawnRun({ ...options, dryRun: false, id: 'B81', launch, queue });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain('B81 still waits on B80');
    expect(queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show']);
    expect(launch).not.toHaveBeenCalled();
  });

  it('prints the plan on a dry run without claiming or launching', async () => {
    const { launch, queue } = run(LISTING);
    const outcome = await spawnRun({ ...options, dryRun: true, id: 'B82', launch, queue });
    expect(outcome.code).toBe(0);
    expect(outcome.report).toContain('tmux session messhall-B82');
    expect(outcome.report).toContain('--model opus');
    expect(outcome.report).toContain('join #dev as f8-thing');
    expect(queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show']);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('flockStop', () => {
  it('refuses a row with no spawned session', async () => {
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('', 1)));
    await expect(flockStop({ row: 'B82', tmux })).resolves.toMatchObject({ code: 1 });
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-B82']);
  });
});
