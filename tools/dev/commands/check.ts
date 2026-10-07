import type { RunResult } from '../lib/run.js';
import type { Command } from 'commander';

import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok, warn } from '../lib/print.js';
import { run } from '../lib/run.js';

import { appBuildsStep } from './appBuilds.js';
import { readFeatureMap } from './featuremap.js';
import { mainCheckout } from './spawn.js';

export interface CheckStep {
  name: string;
  run: () => Promise<RunResult & { warn?: boolean }>;
}

const pnpm = (name: string, script: string): CheckStep => ({ name, run: () => run('pnpm', [script], REPO_ROOT) });

async function featureMapStep() {
  const started = Date.now();
  const result = await readFeatureMap({ check: true });
  return { code: result.code, ms: Date.now() - started, stderr: '', stdout: result.report };
}

export const CHECK_STEPS: CheckStep[] = [
  pnpm('format', 'format:check'),
  pnpm('lint', 'lint'),
  pnpm('types', 'lint:types'),
  pnpm('tests', 'test'),
  { name: 'feature map', run: featureMapStep },
  { name: 'app builds', run: async () => appBuildsStep({ mainCheckout: await mainCheckout() }) },
];

const tail = (text: string, lines: number) => text.trim().split('\n').slice(-lines).join('\n');

const status = (result: RunResult & { warn?: boolean }) => {
  if (result.code !== 0) return bad('fail');
  return result.warn ? warn('warn') : ok('pass');
};

/** Runs every step at once and builds one pass/fail table. Any failed step makes the code 1, a warning does not. */
export async function runCheck({ steps }: { steps: CheckStep[] }) {
  const started = Date.now();
  const results = await Promise.all(steps.map(async step => ({ name: step.name, result: await step.run() })));
  const failed = results.filter(item => item.result.code !== 0);
  const warned = results.filter(item => item.result.code === 0 && item.result.warn);
  const table = formatTable(
    ['step', 'status', 'time'],
    results.map(item => [item.name, status(item.result), `${item.result.ms}ms`]),
  );
  const details = [
    ...warned.map(item => `\n${warn(item.name)}\n${item.result.stdout.trim()}`),
    ...failed.map(item => `\n${bad(item.name)}\n${dim(tail(`${item.result.stdout}\n${item.result.stderr}`, 40))}`),
  ];
  const verdict = `\n${failed.length ? bad('check failed') : ok('all checks passed')} ${dim(`in ${Date.now() - started}ms`)}`;
  return {
    code: failed.length ? 1 : 0,
    failed: failed.map(item => item.name),
    report: [table, ...details, verdict].join('\n'),
  };
}

/** Registers `check`, the gate before every commit. */
export function registerCheck(program: Command) {
  program
    .command('check')
    .description('Run format, lint, types, tests and the feature map check together. The gate before every commit.')
    .action(async () => {
      const result = await runCheck({ steps: CHECK_STEPS });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
