import type { Build } from '../../contracts/health.ts';

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The git commit `dir` is checked out at, with its commit time in UTC. Null when git has no answer.
 * The daemon reads it once at start, so a pull after that shows up as a newer install. */
export function currentBuild({ dir = path.dirname(fileURLToPath(import.meta.url)) }: { dir?: string } = {}) {
  try {
    const out = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%H %cI'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [commit = '', committedAt = ''] = out.trim().split(' ');
    const build: Build = { commit, committed_at: new Date(committedAt).toISOString() };
    return build;
  } catch {
    return null;
  }
}
