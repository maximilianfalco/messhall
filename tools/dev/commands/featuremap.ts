import type { Command } from 'commander';

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { featureMapReport } from '../lib/featureMap.js';
import { FEATURE_MAP_PATH, REPO_ROOT } from '../lib/paths.js';

/** Reads the feature map from disk and checks its code paths against the repo. */
export async function readFeatureMap({ check }: { check: boolean }) {
  const markdown = await readFile(FEATURE_MAP_PATH, 'utf8');
  return featureMapReport({ check, exists: file => existsSync(path.join(REPO_ROOT, file)), markdown });
}

/** Registers `featuremap [--check]`. */
export function registerFeatureMap(program: Command) {
  program
    .command('featuremap')
    .description('Count feature map rows by status and flag built rows whose code paths are missing on disk.')
    .option('--check', 'exit 1 on drift')
    .action(async (options: { check?: boolean }) => {
      const result = await readFeatureMap({ check: Boolean(options.check) });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
