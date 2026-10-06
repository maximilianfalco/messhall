import type { Git } from '../lib/qaAssets.js';
import type { Command } from 'commander';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths.js';
import { bad } from '../lib/print.js';
import { parsePr, QA_BRANCH, uploadQaAssets } from '../lib/qaAssets.js';

const git: Git = (args, options = {}) => {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    input: options.input,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed\n${result.stderr}`);
  return result.stdout.trim();
};

/** Registers `qa-upload <pr> <files...>`. */
export function registerQaUpload(program: Command) {
  program
    .command('qa-upload <pr> <files...>')
    .description(
      `Commit gifs or screenshots to the ${QA_BRANCH} branch under pr-<n>/ and print a markdown image per file.`,
    )
    .action((prArg: string, files: string[]) => {
      const missing = files.filter(file => !existsSync(file));
      if (missing.length) {
        console.log(bad(`no such file: ${missing.join(', ')}`));
        process.exitCode = 1;
        return;
      }
      try {
        const links = uploadQaAssets({ files: files.map(file => path.resolve(file)), git, pr: parsePr(prArg) });
        links.forEach(link => console.log(link));
      } catch (error) {
        console.log(bad(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
