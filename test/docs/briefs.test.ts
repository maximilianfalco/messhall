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
});
