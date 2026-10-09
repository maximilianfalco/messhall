import type { Runner, Worktree } from '../../tools/dev/commands/spawn.js';
import type { RunResult } from '../../tools/dev/lib/run.js';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSTRUCTIONS_MAX_CHARS } from '../../contracts/room.ts';
import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';
import { flockStop, nudgeRun, reviewsReport, seatRun, spawnRun } from '../../tools/dev/commands/spawn.js';
import { parseQueueRow, rowInstructions, spawnPlan } from '../../tools/dev/lib/spawn.js';
import { feedServer } from '../feed/feedServer.js';

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
      slug: 'f8-thing',
    });
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

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
  feed.scratch.store.createRoom({ created_by: 'human', name: 'dev' });
});

afterEach(async () => {
  await feed.close();
});

const plain = (text: string) => stripVTControlCharacters(text);
const daemon = () => ({ dataDir: feed.scratch.dataDir, fetch, url: feed.url });

describe('spawnRun', () => {
  const worktree = mkdtempSync(path.join(tmpdir(), 'spawn-worktree-'));
  const setup = (listing = LISTING) => ({
    queue: vi.fn<Runner>(args => Promise.resolve(result(args[0] === 'show' ? listing : 'ok'))),
    worktree: vi.fn<Worktree>(() => Promise.resolve({ ok: true, path: worktree })),
  });
  const options = {
    get daemon() {
      return daemon();
    },
    model: 'opus',
    room: 'dev',
  };

  it('refuses a blocked row before claiming or spawning anything', async () => {
    const deps = setup();
    const outcome = await spawnRun({ ...options, ...deps, dryRun: false, id: 'B81' });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain('B81 still waits on B80');
    expect(deps.queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show']);
    expect(deps.worktree).not.toHaveBeenCalled();
    expect(feed.scratch.store.listMembers('dev').map(member => member.name)).toStrictEqual(['human']);
  });

  it('prints the plan on a dry run without claiming or spawning', async () => {
    const deps = setup();
    const outcome = await spawnRun({ ...options, ...deps, dryRun: true, id: 'B82' });
    expect(outcome.code).toBe(0);
    expect(plain(outcome.report)).toContain('claim B82');
    expect(plain(outcome.report)).toContain('spawn f8-thing as unassigned in #dev on opus');
    expect(plain(outcome.report)).toContain('row B82 of the job queue');
    expect(deps.queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show']);
    expect(deps.worktree).not.toHaveBeenCalled();
  });

  it('puts the given reviewer and role on the dry run plan', async () => {
    const deps = setup();
    const instructions = path.join(mkdtempSync(path.join(tmpdir(), 'spawn-')), 'worker.md');
    writeFileSync(instructions, 'ask `ready for review: <url> @reviewer-1`');
    const outcome = await spawnRun({
      ...options,
      ...deps,
      assign: 'worker',
      dryRun: true,
      id: 'B82',
      instructions,
      reviewer: 'reviewer-2',
    });
    expect(plain(outcome.report)).toContain('spawn f8-thing as worker');
    expect(outcome.report).toContain('ready for review: <url> @reviewer-2');
    expect(outcome.report).not.toContain('@reviewer-1');
  });

  it.each([
    ['Reviewer 2', 'not a member name'],
    ['reviewer-2', 'needs --instructions'],
  ])('refuses --reviewer %s before claiming anything', async (reviewer, reason) => {
    const deps = setup();
    const outcome = await spawnRun({ ...options, ...deps, dryRun: true, id: 'B82', reviewer });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain(reason);
  });

  it('refuses role instructions over the limit before claiming or making a worktree', async () => {
    const deps = setup();
    const long = path.join(mkdtempSync(path.join(tmpdir(), 'spawn-')), 'long.md');
    writeFileSync(long, 'x'.repeat(INSTRUCTIONS_MAX_CHARS));
    const outcome = await spawnRun({ ...options, ...deps, dryRun: false, id: 'B82', instructions: long });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain('over 4000 chars');
    expect(deps.queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show']);
    expect(deps.worktree).not.toHaveBeenCalled();
  });

  it('claims the row, makes the worktree and seats the agent there through the product spawner', async () => {
    feed.seatOnStart({ name: 'f8-thing', room: 'dev' });
    const deps = setup();
    const outcome = await spawnRun({ ...options, ...deps, assign: 'worker', dryRun: false, id: 'B82' });
    expect(outcome.code).toBe(0);
    expect(plain(outcome.report)).toContain('f8-thing is seated in #dev as worker');
    expect(deps.queue.mock.calls.map(([args]) => args[0])).toStrictEqual(['show', 'claim']);
    const seat = feed.scratch.store.roleOf({ name: 'f8-thing', room: 'dev' });
    expect(seat?.role).toBe('worker');
    expect(seat?.instructions).toContain(`row B82 of the job queue, branch f8/thing`);
    expect(seat?.instructions).toContain(`your worktree is ${worktree}`);
  });

  it('hands the row back when the daemon refuses the spawn', async () => {
    const deps = setup();
    const outcome = await spawnRun({
      ...options,
      ...deps,
      daemon: { ...daemon(), url: 'http://127.0.0.1:1' },
      dryRun: false,
      id: 'B82',
    });
    expect(outcome.code).toBe(1);
    expect(plain(outcome.report)).toContain('messhall is down');
    expect(deps.queue.mock.calls.map(([args]) => args)).toContainEqual(['release', 'B82']);
  });

  it('hands the row back when the worktree fails', async () => {
    const deps = setup();
    deps.worktree.mockResolvedValue({ error: 'worktree failed: pnpm install failed', ok: false });
    const outcome = await spawnRun({ ...options, ...deps, dryRun: false, id: 'B82' });
    expect(outcome.code).toBe(1);
    expect(outcome.report).toContain('pnpm install failed');
    expect(deps.queue.mock.calls.map(([args]) => args)).toContainEqual(['release', 'B82']);
  });
});

describe('seatRun', () => {
  it('prints the plan on a dry run', async () => {
    const outcome = await seatRun({
      cwd: '/repo',
      daemon: daemon(),
      dryRun: true,
      model: 'opus',
      name: 'reviewer-1',
      room: 'dev',
    });
    expect(outcome.code).toBe(0);
    expect(plain(outcome.report)).toContain('spawn reviewer-1 as unassigned in #dev on opus in /repo');
  });

  it('seats the agent through the product spawner', async () => {
    feed.seatOnStart({ name: 'reviewer-1', room: 'dev' });
    const outcome = await seatRun({
      cwd: feed.scratch.dataDir,
      daemon: daemon(),
      dryRun: false,
      model: 'opus',
      name: 'reviewer-1',
      room: 'dev',
    });
    expect(outcome.code).toBe(0);
    expect(plain(outcome.report)).toContain('reviewer-1 is seated in #dev as unassigned');
  });

  it.each([['Reviewer 1'], ['human'], ['orchestrator-but-way-too-long-for-a-member-name']])(
    'refuses the name %s',
    async name => {
      const outcome = await seatRun({ cwd: '/repo', daemon: daemon(), dryRun: true, model: 'opus', name, room: 'dev' });
      expect(outcome.code).toBe(1);
    },
  );
});

describe('flockStop', () => {
  it('refuses a row whose seat was never spawned', async () => {
    const queue = vi.fn<Runner>(() => Promise.resolve(result(LISTING)));
    const outcome = await flockStop({ daemon: daemon(), queue, room: 'dev', target: 'b82' });
    expect(outcome.code).toBe(1);
    expect(plain(outcome.report)).toContain('no spawned seat f8-thing');
  });

  it('stops a row seat by its branch name and says how to hand the row back', async () => {
    feed.seatOnStart({ name: 'f8-follow-reconnect', room: 'dev' });
    await seatRun({
      cwd: feed.scratch.dataDir,
      daemon: daemon(),
      dryRun: false,
      model: 'opus',
      name: 'f8-follow-reconnect',
      room: 'dev',
    });
    const queue = vi.fn<Runner>(() => Promise.resolve(result(LISTING)));
    const outcome = await flockStop({ daemon: daemon(), queue, room: 'dev', target: 'b80' });
    expect(outcome.code).toBe(0);
    expect(plain(outcome.report)).toContain('stopped f8-follow-reconnect');
    expect(plain(outcome.report)).toContain('queue.py release B80');
    expect(plain(outcome.report)).toContain('make app-clean WORKTREE=.worktrees/f8-follow-reconnect');
  });

  it('stops a seat by name without a row hint', async () => {
    feed.seatOnStart({ name: 'reviewer-1', room: 'dev' });
    await seatRun({
      cwd: feed.scratch.dataDir,
      daemon: daemon(),
      dryRun: false,
      model: 'opus',
      name: 'reviewer-1',
      room: 'dev',
    });
    const outcome = await flockStop({ daemon: daemon(), room: 'dev', target: 'reviewer-1' });
    expect(outcome.code).toBe(0);
    expect(plain(outcome.report)).not.toContain('release');
  });
});

describe('nudgeRun', () => {
  const STUCK = ['─'.repeat(40), '❯ carry on', '─'.repeat(40)].join('\n');
  const EMPTY = ['─'.repeat(40), '❯ ', '─'.repeat(40)].join('\n');
  const paneAfter = (panes: string[]) =>
    vi.fn<Runner>(args => {
      if (args[0] === 'display-message') return Promise.resolve(result('✳ Claude Code\n'));
      return Promise.resolve(result(args[0] === 'capture-pane' ? (panes.shift() ?? EMPTY) : ''));
    });

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
      'display-message -p -t messhall-B82 #{pane_title}',
      'send-keys -t messhall-B82 -l carry on',
      'display-message -p -t messhall-B82 #{pane_title}',
      'send-keys -t messhall-B82 Enter',
      'capture-pane -p -e -t messhall-B82',
      'display-message -p -t messhall-B82 #{pane_title}',
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
