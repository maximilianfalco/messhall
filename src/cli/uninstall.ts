import type { Launchctl } from '../lib/launchctl.js';
import type { Command } from 'commander';

import { rmSync } from 'node:fs';

import { launchAgentPath } from '../config.js';
import { systemLaunchctl } from '../lib/launchctl.js';

/** Boots the LaunchAgent out and deletes its plist. Rooms and keys in the data dir stay. */
export async function runUninstall({ launchctl, plistPath }: { launchctl: Launchctl; plistPath: string }) {
  await launchctl.bootout();
  rmSync(plistPath, { force: true });
  return { code: 0, report: `removed ${plistPath}. your rooms and keys are still in the data dir` };
}

/** Registers `uninstall`. */
export function registerUninstall(program: Command) {
  program
    .command('uninstall')
    .description('Stop the daemon and remove its LaunchAgent. Keeps the data dir.')
    .action(async () => {
      const result = await runUninstall({ launchctl: systemLaunchctl(), plistPath: launchAgentPath() });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
