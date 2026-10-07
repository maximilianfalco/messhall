import type { Launchctl } from '../lib/launchctl.js';
import type { Command } from 'commander';

import { existsSync } from 'node:fs';

import { launchAgentPath } from '../config.js';
import { systemLaunchctl } from '../lib/launchctl.js';
import { runCommand } from '../lib/run.js';

import { readClaudeEntry, SEATLESS_LINE } from './mcp.js';
import { localStamps, versionWarnings, type Stamp } from './versions.js';

// Claude Code gives up its event stream when the daemon goes, and opens a new one only on its next call.
const IDLE_LINE = 'an idle claude gets no ring until its next messhall call. restart between tasks, or nudge them';

/** Loads the LaunchAgent if `stop` unloaded it, then restarts the daemon. Warns when the Claude entry
 * has no seat header, since every claude seat then stays away after this restart, and when the built app
 * no longer matches the code the daemon now runs. */
export async function runStart({
  app,
  installed,
  launchctl,
  plistPath,
  run,
}: {
  app: Stamp | undefined;
  installed: Stamp;
  launchctl: Launchctl;
  plistPath: string;
  run: typeof runCommand;
}) {
  if (!existsSync(plistPath)) return { code: 1, report: 'messhall is not installed. run messhall install' };
  if (!(await launchctl.isLoaded())) {
    const boot = await launchctl.bootstrap();
    if (boot.code !== 0) return { code: 1, report: `launchctl bootstrap failed: ${boot.stderr.trim()}` };
  }
  const kick = await launchctl.kickstart();
  if (kick.code !== 0) return { code: 1, report: `launchctl kickstart failed: ${kick.stderr.trim()}` };
  const entry = await readClaudeEntry(run);
  const lines = ['messhall started. check it with messhall status', IDLE_LINE];
  const seatless = entry && !entry.seat ? [SEATLESS_LINE] : [];
  const versions = versionWarnings({ app, daemon: installed, installed });
  return { code: 0, report: [...lines, ...seatless, ...versions].join('\n') };
}

/** Registers `start`. */
export function registerStart(program: Command) {
  program
    .command('start')
    .description('Start or restart the daemon through its LaunchAgent.')
    .action(async () => {
      const result = await runStart({
        ...(await localStamps(runCommand)),
        launchctl: systemLaunchctl(),
        plistPath: launchAgentPath(),
        run: runCommand,
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
