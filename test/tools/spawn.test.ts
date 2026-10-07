import type { Runner } from '../../tools/dev/commands/spawn.js';
import type { launchClaude } from '../../tools/dev/lib/claudeTmux.js';
import type { RunResult } from '../../tools/dev/lib/run.js';

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { KEY_FILES } from '../../src/daemon/keys.js';
import { SEAT_HEADER } from '../../src/mcp/constants.js';
import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';
import {
  flockStop,
  nudgeRun,
  reviewsReport,
  seatRun,
  seatThenAssign,
  spawnRun,
  writeSpawnConfig,
} from '../../tools/dev/commands/spawn.js';
import { claudeArgv } from '../../tools/dev/lib/claudeTmux.js';
import {
  parseFlock,
  parseQueueRow,
  seatPrompt,
  SPAWN_ALLOWED_TOOLS,
  spawnArgv,
  assignLine,
  rowInstructions,
  spawnPlan,
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

describe('row seat prompt', () => {
  const prompt = seatPrompt({ name: 'f8-thing', room: 'dev' });

  it('only seats the agent and waits for a role', () => {
    expect(prompt).toContain('join #dev as f8-thing');
    expect(prompt).toContain('do nothing else until orchestrator or human gives you a role');
    expect(prompt).toContain('follow the instructions it returns');
    expect(prompt).toContain('post "@orchestrator what is my role?"');
    expect(prompt).not.toContain('\n');
  });

  it('fits in one tmux burst with the longest room and name', () => {
    expect(seatPrompt({ name: 'n'.repeat(40), room: 'r'.repeat(40) }).length).toBeLessThan(1000);
  });

  it('ends the turn when idle instead of looping wait', () => {
    expect(prompt).toContain('end your turn and let the doorbell ring you');
    expect(prompt).not.toMatch(/wait again|keep calling wait/);
  });

  it('carries no row id, branch or job words', () => {
    expect(prompt).not.toMatch(/B82|f8\/thing|worktree|queue|row|brief|pickup|job|claim/i);
  });

  it('keeps the agent off the human seat and off scripted clients', () => {
    expect(prompt).toContain('Never speak as the human: no messhall say, no human key, no human-seat routes.');
    expect(prompt).toContain('test with your own name or a scratch daemon (pnpm messhall-dev daemon)');
    expect(prompt).toContain('never through messhall post or messhall-dev agent');
  });
});

describe('rowInstructions', () => {
  const base = { branch: 'f8/thing', id: 'B82', worktree: '/repo/.worktrees/f8-thing' };

  it('names the row, branch, claimed worktree and brief', () => {
    const text = rowInstructions({ ...base, brief: '/notes/brief.md' });
    expect(text).toContain('row B82 of the job queue, branch f8/thing');
    expect(text).toContain('your worktree is /repo/.worktrees/f8-thing');
    expect(text).toContain('its brief is /notes/brief.md');
  });

  it('points at the pickup skill without a brief', () => {
    expect(rowInstructions(base)).toContain('/messhall-pickup-any-work B82');
  });

  it('lets the agent close its own row', () => {
    expect(rowInstructions(base)).toContain('you may run queue.py done B82 yourself');
  });

  it('puts the role text first and the row after it', () => {
    const text = rowInstructions({ ...base, role: 'You are a worker.' });
    expect(text.startsWith('You are a worker.')).toBe(true);
    expect(text.indexOf('row B82')).toBeGreaterThan(0);
  });

  it('names the given reviewer in the review gate', () => {
    const role = 'post `ready for review: <url> @reviewer-1`, then `round N: <url> @reviewer-1`';
    const text = rowInstructions({ ...base, reviewer: 'reviewer-2', role });
    expect(text).toContain('ready for review: <url> @reviewer-2');
    expect(text).toContain('round N: <url> @reviewer-2');
    expect(text).not.toContain('@reviewer-1');
  });
});

describe('assignLine', () => {
  it('is the orchestrator line that sets the role with the instructions file', () => {
    expect(assignLine({ file: '/data/spawn/B82-role.md', member: 'f8-thing', role: 'worker', room: 'dev' })).toBe(
      "pnpm messhall-dev agent orchestrator --room dev --say '@f8-thing your role: worker' --assign f8-thing=worker --instructions /data/spawn/B82-role.md",
    );
  });
});

describe('seatPrompt', () => {
  it('seats a named agent that waits for its role and follows its instructions', () => {
    const prompt = seatPrompt({ name: 'reviewer-1', room: 'dev' });
    expect(prompt).toContain('Read the using-messhall skill first.');
    expect(prompt).toContain('join #dev as reviewer-1');
    expect(prompt).toContain('never call leave.');
    expect(prompt).toContain('call my_role');
    expect(prompt).toContain('a role line mentions you later, call my_role again');
    expect(prompt).not.toContain('until your work is finished');
    expect(seatPrompt({ name: 'web', room: 'dev' })).not.toMatch(/ready for review|approved|merge|review/i);
    expect(prompt).not.toContain('\n');
  });
});

describe('spawnArgv', () => {
  it('is the shared claude argv with the normal tools and the model', () => {
    const files = { debugFile: '/d.log', mcpConfig: '/m.json' };
    expect(spawnArgv({ ...files, mainCheckout: '/repo', model: 'opus' })).toStrictEqual([
      ...claudeArgv({ ...files, allowedTools: [...SPAWN_ALLOWED_TOOLS, 'Read(//repo/personal-dev-notes.md)'] }),
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
    expect(outcome.report).not.toMatch(/prompt: .*B82/);
    expect(outcome.report).toContain('row B82 of the job queue');
    expect(outcome.report).toContain('--assign f8-thing=worker');
    expect(queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show']);
    expect(launch).not.toHaveBeenCalled();
  });

  it('writes the given reviewer into the role instructions on a dry run', async () => {
    const { launch, queue } = run(LISTING);
    const instructions = path.join(mkdtempSync(path.join(tmpdir(), 'spawn-')), 'worker.md');
    writeFileSync(instructions, 'ask `ready for review: <url> @reviewer-1`');
    const outcome = await spawnRun({
      ...options,
      dryRun: true,
      id: 'B82',
      instructions,
      launch,
      queue,
      reviewer: 'reviewer-2',
    });
    expect(outcome.code).toBe(0);
    expect(outcome.report).toContain('ready for review: <url> @reviewer-2');
    expect(outcome.report).not.toContain('@reviewer-1');
  });

  it.each([
    ['Reviewer 2', 'not a member name'],
    ['reviewer-2', 'needs --instructions'],
  ])('refuses --reviewer %s before claiming anything', async (reviewer, reason) => {
    const { launch, queue } = run(LISTING);
    const outcome = await spawnRun({ ...options, dryRun: true, id: 'B82', launch, queue, reviewer });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain(reason);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('writeSpawnConfig', () => {
  const seatIn = (file: string) => JSON.parse(readFileSync(file, 'utf8')).mcpServers.messhall.headers[SEAT_HEADER];

  it('gives a first spawn a fresh seat key', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'spawn-')), 'B82-mcp.json');
    writeSpawnConfig({ file, key: 'k', url: 'http://127.0.0.1:1' });
    expect(seatIn(file)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets a stopped then respawned row take back its seat and role as reconnected', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'spawn-'));
    const file = path.join(dataDir, 'B82-mcp.json');
    const db = openDb({ dataDir });
    const store = createRoomStore({ db, now: () => new Date() });
    writeSpawnConfig({ file, key: 'k', url: 'http://127.0.0.1:1' });
    store.joinRoom({ as: 'f8-thing', kind: 'claude', room: 'dev', seatKey: seatIn(file) });
    store.joinRoom({ as: 'orchestrator', kind: 'claude', room: 'dev' });
    store.assignRole({ by: 'orchestrator', member: 'f8-thing', role: 'worker', room: 'dev' });
    store.markAllAway();

    writeSpawnConfig({ file, key: 'k', url: 'http://127.0.0.1:1' });
    const rejoined = store.joinRoom({ as: 'f8-thing', kind: 'claude', room: 'dev', seatKey: seatIn(file) });
    db.close();

    expect(rejoined).toMatchObject({ change: 'reconnected', member: { role: 'worker' }, ok: true });
  });
});

type Assign = Parameters<typeof seatThenAssign>[0]['assign'];

describe('seatThenAssign', () => {
  const base = { file: '/data/spawn/B82-role.md', member: 'f8-thing', room: 'dev' };

  it('assigns the role once the agent has joined', async () => {
    const joined = vi.fn<(member: string) => boolean>().mockReturnValueOnce(false).mockReturnValue(true);
    const assign = vi.fn<Assign>(() => Promise.resolve({ code: 0, report: 'assigned' }));
    const outcome = await seatThenAssign({ ...base, assign, joined, role: 'worker' });
    expect(outcome.code).toBe(0);
    expect(outcome.lines.join('\n')).toContain('f8-thing joined #dev');
    expect(assign).toHaveBeenCalledWith({ file: base.file, member: 'f8-thing', role: 'worker', room: 'dev' });
  });

  it('prints the assign line to run when no role is given', async () => {
    const assign = vi.fn<Assign>();
    const outcome = await seatThenAssign({ ...base, assign, joined: () => true });
    expect(outcome.code).toBe(0);
    expect(outcome.lines.join('\n')).toContain('--assign f8-thing=worker --instructions /data/spawn/B82-role.md');
    expect(assign).not.toHaveBeenCalled();
  });

  it('says so when the agent has not joined within 2 minutes, and assigns nothing', async () => {
    const assign = vi.fn<Assign>();
    const outcome = await seatThenAssign({ ...base, assign, joined: () => false, role: 'worker', waitMs: 0 });
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join('\n')).toContain('f8-thing has not joined #dev after 2 minutes');
    expect(assign).not.toHaveBeenCalled();
  });

  it('fails when the assign is refused', async () => {
    const assign = vi.fn<Assign>(() => Promise.resolve({ code: 1, report: 'name taken' }));
    const outcome = await seatThenAssign({ ...base, assign, joined: () => true, role: 'worker' });
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join('\n')).toContain('name taken');
  });
});

describe('flockStop', () => {
  it('refuses a row with no spawned session', async () => {
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('', 1)));
    await expect(flockStop({ target: 'b82', tmux })).resolves.toMatchObject({ code: 1 });
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-B82']);
  });

  it('says how to clean the row worktree app build before the worktree goes', async () => {
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('')));
    const queue = vi.fn<Runner>(() => Promise.resolve(result(LISTING)));
    const outcome = await flockStop({ queue, target: 'b80', tmux });
    expect(outcome.report).toContain('make app-clean WORKTREE=.worktrees/f8-follow-reconnect');
    expect(queue).toHaveBeenCalledWith(['show', '--all']);
  });

  it('stops a seated agent by name', async () => {
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('')));
    const outcome = await flockStop({ target: 'reviewer-1', tmux });
    expect(outcome.code).toBe(0);
    expect(outcome.report).not.toContain('release');
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-seat-reviewer-1']);
  });
});

describe('nudgeRun', () => {
  const STUCK = ['─'.repeat(40), '❯ carry on', '─'.repeat(40)].join('\n');
  const EMPTY = ['─'.repeat(40), '❯ ', '─'.repeat(40)].join('\n');
  const paneAfter = (panes: string[]) =>
    vi.fn<Runner>(args => Promise.resolve(result(args[0] === 'capture-pane' ? (panes.shift() ?? EMPTY) : '')));

  it('refuses a session tmux does not have', async () => {
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('', 1)));
    const outcome = await nudgeRun({ session: 'messhall-B82', settleMs: 0, text: 'carry on', tmux });
    expect(outcome.code).toBe(1);
    expect(tmux).toHaveBeenCalledTimes(1);
  });

  it('types the text, then sends a lone Enter until the box is empty', async () => {
    const tmux = paneAfter([STUCK, EMPTY]);
    const outcome = await nudgeRun({ session: 'messhall-B82', settleMs: 0, text: 'carry on', tmux });
    expect(outcome.code).toBe(0);
    expect(tmux.mock.calls.map(([args]) => args.join(' '))).toStrictEqual([
      'has-session -t messhall-B82',
      'send-keys -t messhall-B82 -l carry on',
      'send-keys -t messhall-B82 Enter',
      'capture-pane -p -e -t messhall-B82',
      'send-keys -t messhall-B82 Enter',
      'capture-pane -p -e -t messhall-B82',
    ]);
  });

  it('says the prompt is stuck when Enter never empties the box', async () => {
    const tmux = paneAfter(Array.from({ length: 10 }, () => STUCK));
    const outcome = await nudgeRun({ session: 'messhall-B82', settleMs: 0, text: 'carry on', tmux });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain('stuck');
    expect(tmux.mock.calls.filter(([args]) => args.includes('Enter'))).toHaveLength(5);
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

  it('stops the session and fails when the seat prompt is stuck in the box', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-seat-'));
    writeFileSync(path.join(dataDir, KEY_FILES.agent), 'scratch-key');
    const tmux = vi.fn<Runner>(() => Promise.resolve(result('')));
    const outcome = await seatRun({
      dataDir,
      dryRun: false,
      launch: () => Promise.resolve('registered'),
      model: 'opus',
      name: 'scratch-seat',
      room: 'dev',
      tmux,
      type: () => Promise.resolve('stuck'),
      url: 'http://127.0.0.1:1',
    });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain('stuck');
    expect(tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-seat-scratch-seat']);
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

describe('reviewsReport', () => {
  it('lists a request in the newest page of a room longer than one page', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-reviews-'));
    const now = new Date('2026-10-06T12:30:00.000Z');
    const db = openDb({ dataDir });
    const store = createRoomStore({ db, now: () => now });
    store.joinRoom({ as: 'f8-thing', kind: 'claude', room: 'dev' });
    for (const step of Array.from({ length: 600 }, (_, n) => `step ${n}`)) {
      store.postMessage({ from: 'f8-thing', room: 'dev', text: step });
    }
    store.postMessage({
      from: 'f8-thing',
      room: 'dev',
      text: 'CI green. ready for review: https://github.com/acme/widgets/pull/12 @reviewer-1',
    });
    db.close();

    const outcome = reviewsReport({ dataDir, now, room: 'dev' });

    expect(outcome.code).toBe(0);
    expect(outcome.report).toContain('https://github.com/acme/widgets/pull/12');
    expect(outcome.report).toContain('waiting');
  });
});
