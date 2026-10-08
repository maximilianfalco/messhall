import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { criticalGlobs, mergePr } from '../../tools/dev/lib/merge.js';
import { REPO_ROOT } from '../../tools/dev/lib/paths.js';

const CRITICAL = ['# Critical', '', '```paths', 'CRITICAL.md', 'src/daemon/keys.ts', 'src/flock/**', '```', ''].join(
  '\n',
);

const fakeGh = ({
  changedFiles,
  files,
  labels = [],
}: {
  changedFiles?: number;
  files: string[];
  labels?: string[];
}) => {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    if (args[1] !== 'view') return '';
    return JSON.stringify({
      changedFiles: changedFiles ?? files.length,
      files: files.map(file => ({ path: file })),
      headRefName: 'f10/demo',
      headRefOid: 'abc123',
      labels: labels.map(name => ({ name })),
    });
  };
  return { calls, gh };
};

const goneBranch = (gh: (args: string[]) => string) => (args: string[]) => {
  if (args[0] === 'api') throw new Error('Reference does not exist');
  return gh(args);
};

const merges = (calls: string[][]) => calls.filter(args => args[1] === 'merge');

describe('criticalGlobs', () => {
  it('reads the paths block of CRITICAL.md', () => {
    expect(criticalGlobs(CRITICAL)).toStrictEqual(['CRITICAL.md', 'src/daemon/keys.ts', 'src/flock/**']);
  });
});

describe('mergePr', () => {
  it('squash merges a plain PR as admin, pinned to the head it checked', () => {
    const { calls, gh } = fakeGh({ files: ['src/rooms/store.ts', 'docs/briefs/worker.md'] });

    expect(mergePr({ critical: CRITICAL, gh, pr: 7 })).toStrictEqual({ deleted: true, ok: true });
    expect(merges(calls)).toStrictEqual([['pr', 'merge', '7', '--squash', '--admin', '--match-head-commit', 'abc123']]);
  });

  it('deletes only the merged PR head branch, after the merge', () => {
    const { calls, gh } = fakeGh({ files: ['README.md'] });
    mergePr({ critical: CRITICAL, gh, pr: 7 });

    expect(calls.slice(-2).map(args => args.slice(0, 2))).toStrictEqual([
      ['pr', 'merge'],
      ['api', '-X'],
    ]);
    expect(calls.at(-1)).toStrictEqual(['api', '-X', 'DELETE', 'repos/{owner}/{repo}/git/refs/heads/f10/demo']);
  });

  it('refuses a PR with the human veto label', () => {
    const { calls, gh } = fakeGh({ files: ['README.md'], labels: ['human veto'] });

    expect(mergePr({ critical: CRITICAL, gh, pr: 7 })).toStrictEqual({ files: [], ok: false, reason: 'human_veto' });
    expect(merges(calls)).toStrictEqual([]);
  });

  it('refuses a PR that touches a critical tree before the labeler has run', () => {
    const { calls, gh } = fakeGh({ files: ['README.md', 'src/flock/spawner.ts', 'src/daemon/keys.ts'] });

    expect(mergePr({ critical: CRITICAL, gh, pr: 7 })).toStrictEqual({
      files: ['src/flock/spawner.ts', 'src/daemon/keys.ts'],
      ok: false,
      reason: 'human_veto',
    });
    expect(merges(calls)).toStrictEqual([]);
  });

  it('refuses when gh lists fewer files than the PR changes, since the hidden ones could be critical', () => {
    const { calls, gh } = fakeGh({ changedFiles: 140, files: ['README.md'] });

    expect(mergePr({ critical: CRITICAL, gh, pr: 7 })).toStrictEqual({
      files: [],
      ok: false,
      reason: 'too_many_files',
    });
    expect(merges(calls)).toStrictEqual([]);
  });

  it('still reports the merge when the branch is already gone', () => {
    const { calls, gh } = fakeGh({ files: ['README.md'] });

    expect(mergePr({ critical: CRITICAL, gh: goneBranch(gh), pr: 7 })).toStrictEqual({ deleted: false, ok: true });
    expect(merges(calls)).toHaveLength(1);
  });

  it('never takes a sibling of a critical file for the file', () => {
    const { gh } = fakeGh({ files: ['src/daemon/keys.test.ts', 'src/flockish/a.ts'] });

    expect(mergePr({ critical: CRITICAL, gh, pr: 7 })).toStrictEqual({ deleted: true, ok: true });
  });

  it.each(['docs/briefs/worker.settings.json', 'tools/dev/lib/merge.ts', 'tools/dev/commands/merge.ts'])(
    'refuses a PR that changes %s, so a worker cannot widen what it may merge',
    file => {
      const { calls, gh } = fakeGh({ files: [file] });
      const critical = readFileSync(path.join(REPO_ROOT, 'CRITICAL.md'), 'utf8');

      expect(mergePr({ critical, gh, pr: 7 })).toStrictEqual({ files: [file], ok: false, reason: 'human_veto' });
      expect(merges(calls)).toStrictEqual([]);
    },
  );
});
