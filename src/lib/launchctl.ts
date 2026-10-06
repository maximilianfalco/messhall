import type { Runner } from './run.js';

import { userInfo } from 'node:os';

import { LAUNCH_AGENT_LABEL, launchAgentPath } from '../config.js';

import { runCommand } from './run.js';

type LaunchAction = 'bootout' | 'bootstrap' | 'kickstart' | 'print';

interface Target {
  domain: string;
  plistPath: string;
  service: string;
}

const ARGS: Record<LaunchAction, (target: Target) => string[]> = {
  bootout: ({ service }) => ['bootout', service],
  bootstrap: ({ domain, plistPath }) => ['bootstrap', domain, plistPath],
  kickstart: ({ service }) => ['kickstart', '-k', service],
  print: ({ service }) => ['print', service],
};

/** Every launchctl call messhall makes, on the daemon's LaunchAgent in `gui/<uid>`. Tests pass a fake `run`. */
export function createLaunchctl({ plistPath, run, uid }: { plistPath: string; run: Runner; uid: number }) {
  const domain = `gui/${uid}`;
  const target: Target = { domain, plistPath, service: `${domain}/${LAUNCH_AGENT_LABEL}` };
  const call = (action: LaunchAction) => run('launchctl', ARGS[action](target));
  return {
    bootout: () => call('bootout'),
    bootstrap: () => call('bootstrap'),
    /** True when launchd knows the agent, running or not. */
    isLoaded: async () => (await call('print')).code === 0,
    kickstart: () => call('kickstart'),
    /** The command line an action would run, for `--print`. */
    line: (action: LaunchAction) => ['launchctl', ...ARGS[action](target)].join(' '),
  };
}

export type Launchctl = ReturnType<typeof createLaunchctl>;

/** The real launchctl for this user's LaunchAgent. */
export function systemLaunchctl() {
  return createLaunchctl({ plistPath: launchAgentPath(), run: runCommand, uid: userInfo().uid });
}
