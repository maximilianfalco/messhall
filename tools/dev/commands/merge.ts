import type { Gh } from '../lib/merge.js';
import type { Command } from 'commander';

import { spawnSync } from 'node:child_process';

import { mergePr, VETO_LABEL } from '../lib/merge.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, ok } from '../lib/print.js';
import { parsePr } from '../lib/qaAssets.js';

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}`);
  return result.stdout;
};
const gh: Gh = args => run('gh', args);

// From main, not this checkout, so a PR cannot shorten the list it is checked against.
const mainCritical = () => {
  run('git', ['fetch', 'origin', 'main']);
  return run('git', ['show', 'FETCH_HEAD:CRITICAL.md']);
};

/** Registers `merge <pr>`. */
export function registerMerge(program: Command) {
  program
    .command('merge <pr>')
    .description(`Squash merge a PR as admin. Refuses one with the ${VETO_LABEL} label or a CRITICAL.md file.`)
    .action((prArg: string) => {
      try {
        const pr = parsePr(prArg);
        const merged = mergePr({ critical: mainCritical(), gh, pr });
        if (merged.ok) {
          console.log(ok(`merged #${pr} (squash)${merged.deleted ? ', branch deleted' : ', branch was already gone'}`));
          return;
        }
        const why =
          merged.reason === 'too_many_files'
            ? 'gh lists fewer files than it changes, so the critical check cannot see them all'
            : `${VETO_LABEL}${merged.files.length ? `: ${merged.files.join(', ')}` : ''}`;
        console.log(bad(`not merged, ${why}. the owner merges this one`));
        process.exitCode = 1;
      } catch (error) {
        console.log(bad(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
