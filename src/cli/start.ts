import type { Launchctl } from '../lib/launchctl.js';
import type { Command } from 'commander';

import { existsSync } from 'node:fs';

import { launchAgentPath } from '../config.js';
import { systemLaunchctl } from '../lib/launchctl.js';

/** Loads the LaunchAgent if `stop` unloaded it, then restarts the daemon. */
export async function runStart({ launchctl, plistPath }: { launchctl: Launchctl; plistPath: string }) {
  if (!existsSync(plistPath)) return { code: 1, report: 'messhall is not installed. run messhall install' };
  if (!(await launchctl.isLoaded())) {
    const boot = await launchctl.bootstrap();
    if (boot.code !== 0) return { code: 1, report: `launchctl bootstrap failed: ${boot.stderr.trim()}` };
  }
  const kick = await launchctl.kickstart();
  if (kick.code !== 0) return { code: 1, report: `launchctl kickstart failed: ${kick.stderr.trim()}` };
  return { code: 0, report: 'messhall started. check it with messhall status' };
}

/** Registers `start`. */
export function registerStart(program: Command) {
  program
    .command('start')
    .description('Start or restart the daemon through its LaunchAgent.')
    .action(async () => {
      const result = await runStart({ launchctl: systemLaunchctl(), plistPath: launchAgentPath() });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
