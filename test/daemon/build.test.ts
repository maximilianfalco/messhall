import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSchema } from '../../contracts/health.ts';
import { currentBuild } from '../../src/daemon/build.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'messhall-build-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

function git(...args: string[]) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-03-04T05:06:07+02:00',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_AUTHOR_NAME: 'test',
      GIT_COMMITTER_DATE: '2026-03-04T05:06:07+02:00',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
    },
  }).trim();
}

describe('currentBuild', () => {
  it('gives the head commit and its commit time in UTC', () => {
    git('init', '-q');
    writeFileSync(path.join(dir, 'file.txt'), 'one');
    git('add', '.');
    git('commit', '-q', '--no-gpg-sign', '-m', 'one');

    const build = currentBuild({ dir });

    expect(build).toStrictEqual({ commit: git('rev-parse', 'HEAD'), committed_at: '2026-03-04T03:06:07.000Z' });
    expect(buildSchema.parse(build)).toStrictEqual(build);
  });

  it('gives null outside a git checkout', () => {
    expect(currentBuild({ dir })).toBeNull();
  });

  it('gives null in a checkout with no commit yet', () => {
    git('init', '-q');

    expect(currentBuild({ dir })).toBeNull();
  });

  it('reads the checkout this code runs from by default', () => {
    expect(currentBuild()?.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
