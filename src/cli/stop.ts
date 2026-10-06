import type { Launchctl } from '../lib/launchctl.js';
import type { Command } from 'commander';

import { systemLaunchctl } from '../lib/launchctl.js';

/** Boots the LaunchAgent out, so the daemon stays stopped until `start` or the next login. */
export async function runStop({ launchctl }: { launchctl: Launchctl }) {
  const result = await launchctl.bootout();
  return { code: 0, report: result.code === 0 ? 'messhall stopped' : 'messhall was not running' };
}

/** Registers `stop`. */
export function registerStop(program: Command) {
  program
    .command('stop')
    .description('Stop the daemon through its LaunchAgent.')
    .action(async () => {
      const result = await runStop({ launchctl: systemLaunchctl() });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
