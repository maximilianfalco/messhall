import type { Command } from 'commander';

import { existsSync, readFileSync } from 'node:fs';

import { healthSchema } from '../../contracts/health.ts';
import { daemonUrl, HEALTH_TIMEOUT_MS, launchAgentPath } from '../config.js';
import { plistNodePath } from '../lib/plist.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Asks `<url>/health`. `other` means something answered that is not messhall. */
export async function probeHealth({ fetch, url }: { fetch: Fetch; url: string }) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const parsed = healthSchema.safeParse(await response.json().catch(() => {}));
    return parsed.success ? ({ health: parsed.data, state: 'up' } as const) : ({ state: 'other' } as const);
  } catch {
    return { state: 'down' } as const;
  }
}

function uptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours ? `${hours}h` : '', hours || minutes ? `${minutes}m` : '', `${seconds % 60}s`]
    .filter(Boolean)
    .join(' ');
}

/** The `status` report: up or down, the health numbers, and a warning when the LaunchAgent's node is gone. */
export async function runStatus({
  fetch,
  nodeExists,
  plist,
  url,
}: {
  fetch: Fetch;
  nodeExists: (file: string) => boolean;
  plist: string | undefined;
  url: string;
}) {
  const probe = await probeHealth({ fetch, url });
  const node = plist === undefined ? undefined : plistNodePath(plist);
  const warning =
    node && !nodeExists(node)
      ? [`warning: the LaunchAgent runs ${node}, which is gone. run messhall install again`]
      : [];
  if (probe.state === 'down') {
    return {
      code: 1,
      report: [`messhall is down, nothing answers on ${url}. run messhall start`, ...warning].join('\n'),
    };
  }
  if (probe.state === 'other') {
    return { code: 1, report: [`something answers on ${url}, but it is not messhall`, ...warning].join('\n') };
  }
  const { health } = probe;
  const lines = [
    `messhall is up on ${url}`,
    `version  ${health.version}`,
    `uptime   ${uptime(health.uptime_s)}`,
    `rooms    ${health.rooms}`,
    `live     ${health.live_members} ${health.live_members === 1 ? 'member' : 'members'}`,
  ];
  return { code: 0, report: [...lines, ...warning].join('\n') };
}

/** Registers `status`. */
export function registerStatus(program: Command) {
  program
    .command('status')
    .description('Say whether the daemon is up, with its version, uptime, rooms and live members.')
    .action(async () => {
      const plistPath = launchAgentPath();
      const result = await runStatus({
        fetch,
        nodeExists: existsSync,
        plist: existsSync(plistPath) ? readFileSync(plistPath, 'utf8') : undefined,
        url: daemonUrl(),
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
