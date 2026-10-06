import type { Command } from 'commander';

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { probeHealth } from '../../../src/cli/status.js';
import { DAEMON_HOST, NODE_QUIET_FLAG } from '../../../src/config.js';
import { LOG_FILE } from '../../../src/lib/logger.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';

const UP_WITHIN_MS = 10_000;
const POLL_MS = 100;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, DAEMON_HOST, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const logTail = (home: string) => {
  try {
    return readFileSync(path.join(home, 'logs', LOG_FILE), 'utf8')
      .trim()
      .split('\n')
      .slice(-5)
      .join('\n');
  } catch {
    return '';
  }
};

/** Spawns `messhall daemon` from source on `home` and `port` and waits for /health. */
export async function spawnDaemon({ detached, home, port }: { detached: boolean; home: string; port: number }) {
  const url = `http://${DAEMON_HOST}:${port}`;
  const child = spawn(
    process.execPath,
    [NODE_QUIET_FLAG, '--import', 'tsx', path.join(REPO_ROOT, 'src', 'cli.ts'), 'daemon'],
    {
      cwd: REPO_ROOT,
      detached,
      env: { ...process.env, MESSHALL_HOME: home, MESSHALL_PORT: String(port) },
      stdio: 'ignore',
    },
  );
  let exited: number | null | undefined;
  child.on('exit', code => {
    exited = code;
  });

  const deadline = Date.now() + UP_WITHIN_MS;
  const waitUp = async (): Promise<Awaited<ReturnType<typeof probeHealth>>> => {
    const probe = await probeHealth({ fetch, url });
    if (probe.state === 'up' || exited !== undefined || Date.now() > deadline) return probe;
    await sleep(POLL_MS);
    return waitUp();
  };
  const probe = await waitUp();
  if (probe.state !== 'up') {
    child.kill();
    const why = exited === undefined ? `no answer on ${url} within ${UP_WITHIN_MS}ms` : `daemon exited ${exited}`;
    return { ok: false, report: [bad(why), dim(logTail(home))].join('\n') } as const;
  }
  const stop = async () => {
    if (exited !== undefined) return exited;
    const stopped = new Promise(resolve => {
      child.once('exit', resolve);
    });
    child.kill('SIGTERM');
    await stopped;
    return exited;
  };
  return { child, ok: true, probe, stop, url } as const;
}

/** Starts `messhall daemon` from source on a scratch home and port, waits for /health, and stops it unless `keep`. */
async function scratchDaemon({ keep }: { keep: boolean }) {
  const ownHome = !process.env.MESSHALL_HOME;
  const home = process.env.MESSHALL_HOME || mkdtempSync(path.join(tmpdir(), 'messhall-daemon-'));
  const port = process.env.MESSHALL_PORT ? Number(process.env.MESSHALL_PORT) : await freePort();
  const daemon = await spawnDaemon({ detached: keep, home, port });
  if (!daemon.ok) return { code: 1, report: daemon.report };
  const { child, probe, url } = daemon;

  const rows = [
    ['url', url],
    ['pid', String(child.pid)],
    ['data dir', home],
    ['health', JSON.stringify(probe.health)],
  ];
  const table = formatTable(['daemon', ''], rows);
  if (keep) {
    child.unref();
    return { code: 0, report: [table, '', ok(`left running, stop it with kill ${child.pid}`)].join('\n') };
  }
  const exited = await daemon.stop();
  if (ownHome) rmSync(home, { force: true, recursive: true });
  return { code: 0, report: [table, '', ok(`stopped, exit ${exited}`)].join('\n') };
}

/** Registers `daemon [--keep]`. */
export function registerDaemon(program: Command) {
  program
    .command('daemon')
    .description('Start a scratch daemon on a temp data dir and a free port, print its url, health and pid.')
    .option('--keep', 'leave it running')
    .action(async (options: { keep?: boolean }) => {
      const result = await scratchDaemon({ keep: Boolean(options.keep) });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
