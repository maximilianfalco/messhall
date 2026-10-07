import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INSTRUCTIONS_MAX_CHARS } from '../../contracts/room.ts';
import { REPO_ROOT } from '../../tools/dev/lib/paths.js';
import { DEFAULT_REVIEWER } from '../../tools/dev/lib/spawn.js';

const BRIEFS = path.join(REPO_ROOT, 'docs', 'briefs');

describe('example role briefs', () => {
  it.each(readdirSync(BRIEFS))('%s fits in assign_role instructions', file => {
    expect(readFileSync(path.join(BRIEFS, file), 'utf8').trim().length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
  });
});

describe('worker brief', () => {
  const worker = readFileSync(path.join(BRIEFS, 'worker.md'), 'utf8');

  it('names the default reviewer that spawn --reviewer swaps out', () => {
    expect(worker).toContain(`@${DEFAULT_REVIEWER}`);
  });

  it('idles on the doorbell for a reviewer but loops wait for a human merge, which rings nothing', () => {
    expect(worker).toContain('Waiting on a reviewer: end your turn and let the doorbell ring you.');
    expect(worker).toContain('call `wait` in a loop and run `gh pr view <n> --json state` each time it returns');
  });
});

describe('progress on the seat', () => {
  it.each(['worker.md', 'reviewer.md'])('%s sends progress to set_status, not the room', file => {
    const brief = readFileSync(path.join(BRIEFS, file), 'utf8');

    expect(brief).toContain('`set_status`');
    expect(brief).not.toContain('Post one short line in the room at each point');
  });
});

describe('worktree removal', () => {
  const docs = [
    path.join(BRIEFS, 'reviewer.md'),
    path.join(REPO_ROOT, '.claude', 'skills', 'messhall-pickup-any-work', 'SKILL.md'),
  ];

  it.each(docs)('%s cleans the app build before each git worktree remove', file => {
    const removals = readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => line.includes('git worktree remove'));

    expect(removals.length).toBeGreaterThan(0);
    removals.forEach(line => expect(line).toMatch(/make app-clean WORKTREE=\S+.*(&&|;) git worktree remove/));
  });
});
