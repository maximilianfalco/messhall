import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const skillScripts = '.claude/skills/messhall-pickup-any-work/scripts';

let home: string;
let queueNote: string;

const runQueue = (...args: string[]) => {
  const result = spawnSync('python3', [path.join(home, skillScripts, 'queue.py'), ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const readQueue = () => readFileSync(queueNote, 'utf8');
const rowOf = (id: string) =>
  readQueue()
    .split('\n')
    .find(line => line.startsWith(`| ${id} |`));

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-queue-'));
  mkdirSync(path.join(home, skillScripts), { recursive: true });
  copyFileSync(path.join(root, skillScripts, 'queue.py'), path.join(home, skillScripts, 'queue.py'));
  queueNote = path.join(home, 'queue.md');
  copyFileSync(path.join(root, 'test/skills/fixtures/job-queue.md'), queueNote);
  writeFileSync(path.join(home, 'personal-dev-notes.md'), `# Notes\n\n- **Job queue:** \`${queueNote}\`\n`);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('queue.py', () => {
  it('prints the queue path from personal-dev-notes.md', () => {
    expect(runQueue('path')).toStrictEqual({ code: 0, stdout: `${queueNote}\n`, stderr: '' });
  });

  it('shows only ready rows across the research, decision and build tables', () => {
    const ids = runQueue('show')
      .stdout.trim()
      .split('\n')
      .map(line => line.split(' ')[0]);
    expect(ids).toStrictEqual(['R92', 'D91', 'B91']);
  });

  it('labels rows without a lane by their table', () => {
    const lines = runQueue('show').stdout.trim().split('\n');
    expect(lines.map(line => /\[(\w+)\]/.exec(line)?.[1])).toStrictEqual(['research', 'decisions', 'A']);
  });

  it('shows every row with --all', () => {
    expect(runQueue('show', '--all').stdout.trim().split('\n')).toHaveLength(7);
  });

  it('claims an open row whose needs are done', () => {
    const result = runQueue('claim', 'B91', 'agent 2026-01-02 10:00 f1/kettle', '.worktrees/f1-kettle');
    expect(result.code).toBe(0);
    expect(rowOf('B91')).toBe(
      '| B91 | Kettle timer | A | `f1/kettle` | R91 | claimed | agent 2026-01-02 10:00 f1/kettle | `.worktrees/f1-kettle` |  |',
    );
  });

  it('refuses to claim a row whose needs are not done', () => {
    const before = readQueue();
    const result = runQueue('claim', 'B92', 'agent 2026-01-02 10:00 f2/mugs', '.worktrees/f2-mugs');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('B92 still waits on D92');
    expect(readQueue()).toBe(before);
  });

  it('refuses to claim a row someone else claimed', () => {
    const before = readQueue();
    const result = runQueue('claim', 'B93', 'agent 2026-01-02 10:00 f1/shelf', '.worktrees/f1-shelf');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('B93 is claimed');
    expect(readQueue()).toBe(before);
  });

  it('releases a claimed row back to open', () => {
    runQueue('release', 'B93');
    expect(rowOf('B93')).toBe('| B93 | Tea shelf | A | `f1/shelf` | none | open |  |  |  |');
  });

  it('marks a row done and appends the evidence to the end of the done log', () => {
    const result = runQueue('done', 'B93', 'https://example.com/pr/9', 'tea shelf shipped, checked by hand');
    expect(result.code).toBe(0);
    expect(rowOf('B93')).toBe(
      '| B93 | Tea shelf | A | `f1/shelf` | none | done | agent 2026-01-01 09:00 f1/shelf |  | https://example.com/pr/9 |',
    );
    const log = readQueue().trimEnd().split('\n').slice(-2);
    expect(log[0]).toBe('- 2026-01-01: R91 done, kettles boil at 100C.');
    expect(log[1]).toMatch(/^- \d{4}-\d{2}-\d{2}: tea shelf shipped, checked by hand$/);
  });
});
