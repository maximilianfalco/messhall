import type { RunResult } from '../../src/lib/run.js';

import { createLaunchctl } from '../../src/lib/launchctl.js';

/** A launchctl over a fake runner that records each call and answers with the code set for its subcommand. */
export function fakeLaunchctl({ codes = {}, plistPath }: { codes?: Record<string, number>; plistPath: string }) {
  const calls: string[] = [];
  const launchctl = createLaunchctl({
    plistPath,
    run: async (command, args) => {
      calls.push([command, ...args].join(' '));
      const result: RunResult = { code: codes[args[0] ?? ''] ?? 0, stderr: 'launchctl said no', stdout: '' };
      return result;
    },
    uid: 501,
  });
  return { calls, launchctl };
}
