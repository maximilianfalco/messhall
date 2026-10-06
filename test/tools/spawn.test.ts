import type { Runner } from '../../tools/dev/commands/spawn.js';
import type { launchClaude } from '../../tools/dev/lib/claudeTmux.js';
import type { RunResult } from '../../tools/dev/lib/run.js';

import { describe, expect, it, vi } from 'vitest';

import { flockStop, seatRun, spawnRun } from '../../tools/dev/commands/spawn.js';
import { claudeArgv } from '../../tools/dev/lib/claudeTmux.js';
import {
  parseFlock,
  parseQueueRow,
  seatPrompt,
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
  const base = {
    branch: 'f8/thing',
    id: 'B82',
    reviewers: ['reviewer-1'],
    room: 'dev',
    worktree: '/repo/.worktrees/f8-thing',
  };

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

  it('waits for a worker role before it starts the row', () => {
    const prompt = spawnPrompt(base);
    expect(prompt).toContain('post one line saying who you are');
    expect(prompt).toContain('do nothing else until orchestrator or human posts "@f8-thing your role: ..."');
    expect(prompt).toContain('check it with list_members');
    expect(prompt).toContain('post "@orchestrator what is my role?"');
    expect(prompt.indexOf('your role: ...')).toBeLessThan(prompt.indexOf('/messhall-pickup-any-work B82'));
  });

  it('gates the merge on a review from the first reviewer, or a human go', () => {
    const prompt = spawnPrompt(base);
    expect(prompt).toContain('do not merge on green CI');
    expect(prompt).toContain('post "ready for review: <PR url> @reviewer-1"');
    expect(prompt).toContain('post "round N: <PR url> @reviewer-1"');
    expect(prompt).toContain(
      'merge only after "approved @f8-thing <PR url>" from reviewer-1 or a human line that says go',
    );
    expect(prompt).toContain('"@human stuck", stop and wait for the human');
    expect(prompt).toContain('CRITICAL.md tree still waits for the human');
  });

  it('names the first reviewer and takes approval from any of them', () => {
    const prompt = spawnPrompt({ ...base, reviewers: ['reviewer-2', 'reviewer-1'] });
    expect(prompt).toContain('"ready for review: <PR url> @reviewer-2"');
    expect(prompt).toContain('from reviewer-2 or reviewer-1 or a human line');
  });
});

describe('seatPrompt', () => {
  it('seats a named agent that waits for its role, then follows the agent brief', () => {
    const prompt = seatPrompt({ name: 'reviewer-1', room: 'dev' });
    expect(prompt).toContain('Read the using-messhall skill first.');
    expect(prompt).toContain('join #dev as reviewer-1');
    expect(prompt).toContain('never call leave');
    expect(prompt).toContain('do nothing else until orchestrator or human posts "@reviewer-1 your role: ..."');
    expect(prompt).toContain('post "@orchestrator what is my role?"');
    expect(prompt).toMatch(/tools\/dev\/briefs\/agent\.md/);
    expect(prompt).not.toContain('rubric');
    expect(prompt).not.toContain('\n');
  });

  it('adds the extra rubric for reviews when one is given', () => {
    expect(seatPrompt({ name: 'reviewer-1', room: 'dev', rubric: '/notes/rubric.md' })).toContain(
      'when you review, also use the rubric in /notes/rubric.md',
    );
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
      { kind: 'row', pane: '%3', pid: 4242, row: 'B82', session: 'messhall-B82' },
      { kind: 'row', pane: '%7', pid: 777, row: 'D80', session: 'messhall-D80' },
    ]);
  });

  it('reads a seated agent session as a seat with its name', () => {
    const listing = ['messhall-seat-reviewer-1\t%9\t900', 'messhall-B82\t%3\t4242'].join('\n');
    expect(parseFlock(listing)).toStrictEqual([
      { kind: 'seat', name: 'reviewer-1', pane: '%9', pid: 900, session: 'messhall-seat-reviewer-1' },
      { kind: 'row', pane: '%3', pid: 4242, row: 'B82', session: 'messhall-B82' },
    ]);
  });
});

describe('spawnRun', () => {
  const run = (listing: string) => {
    const queue = vi.fn<Runner>(args => Promise.resolve(result(args[0] === 'show' ? listing : 'ok')));
    const launch = vi.fn<typeof launchClaude>();
    return { launch, queue };
  };
  const options = {
    brief: undefined,
    dataDir: '/nowhere',
    model: 'opus',
    reviewers: ['reviewer-1'],
    room: 'dev',
    url: 'http://127.0.0.1:1',
  };

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
    await expect(flockStop({ target: 'b82', tmux })).resolves.toMatchObject({ code: 1 });
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-B82']);
  });

  it('stops a seated agent by name', async () => {
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('')));
    const outcome = await flockStop({ target: 'reviewer-1', tmux });
    expect(outcome.code).toBe(0);
    expect(outcome.report).not.toContain('release');
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-seat-reviewer-1']);
  });
});

describe('seatRun', () => {
  it('prints the plan on a dry run without launching', async () => {
    const launch = vi.fn<typeof launchClaude>();
    const outcome = await seatRun({
      dataDir: '/nowhere',
      dryRun: true,
      launch,
      model: 'opus',
      name: 'reviewer-1',
      room: 'dev',
      url: 'http://127.0.0.1:1',
    });
    expect(outcome.code).toBe(0);
    expect(outcome.report).toContain('tmux session messhall-seat-reviewer-1');
    expect(outcome.report).toContain('join #dev as reviewer-1');
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([['Reviewer 1'], ['human'], ['orchestrator-but-way-too-long-for-a-member-name']])(
    'refuses the name %s',
    async name => {
      const launch = vi.fn<typeof launchClaude>();
      const outcome = await seatRun({
        dataDir: '/nowhere',
        dryRun: true,
        launch,
        model: 'opus',
        name,
        room: 'dev',
        url: 'http://127.0.0.1:1',
      });
      expect(outcome.code).toBe(1);
      expect(launch).not.toHaveBeenCalled();
    },
  );
});
