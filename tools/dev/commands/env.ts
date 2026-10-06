import type { Command } from 'commander';

import { probeHealth } from '../../../src/cli/status.js';
import { daemonUrl, dataDir } from '../../../src/config.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { run } from '../lib/run.js';

// Claude Code shipped Channels in this release.
const CHANNELS_SINCE = [2, 1, 80] as const;

type EnvState = 'info' | 'missing' | 'ok';

interface EnvCheck {
  detail: string;
  name: string;
  state: EnvState;
}

const STATE_LABEL: Record<EnvState, string> = { info: dim('info'), missing: bad('missing'), ok: ok('ok') };

/** True when a `claude --version` line is 2.1.80 or newer. */
export function hasChannels(version: string) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  const index = parts.findIndex((part, at) => part !== CHANNELS_SINCE[at]);
  return index === -1 || parts[index]! > CHANNELS_SINCE[index]!;
}

async function toolCheck(name: string, command: string, args: string[]) {
  const result = await run(command, args, REPO_ROOT);
  const line = `${result.stdout}${result.stderr}`.trim().split('\n')[0] ?? '';
  const check: EnvCheck = { detail: line.slice(0, 60), name, state: result.code === 0 ? 'ok' : 'missing' };
  return check;
}

async function claudeCheck() {
  const check = await toolCheck('claude', 'claude', ['--version']);
  if (check.state === 'missing') return check;
  const channels = hasChannels(check.detail);
  return { ...check, detail: `${check.detail}, ${channels ? 'has channels' : 'no channels, needs 2.1.80+'}` };
}

// A down daemon is normal while nothing is installed, so it never fails the command.
async function daemonCheck() {
  const url = daemonUrl();
  const probe = await probeHealth({ fetch, url });
  if (probe.state !== 'up') {
    const detail = probe.state === 'down' ? `down, nothing answers ${url}` : `${url} answers, but it is not messhall`;
    const check: EnvCheck = { detail, name: 'daemon', state: 'info' };
    return check;
  }
  const { health } = probe;
  const check: EnvCheck = {
    detail: `up on ${url}, v${health.version}, ${health.rooms} rooms, ${health.live_members} live members, up ${health.uptime_s}s`,
    name: 'daemon',
    state: 'ok',
  };
  return check;
}

/** Registers `env`, the tools and paths this machine needs. */
export function registerEnv(program: Command) {
  program
    .command('env')
    .description('Show node, pnpm, claude (and channels), codex, the data dir and whether the daemon answers.')
    .action(async () => {
      const checks: EnvCheck[] = await Promise.all([
        { detail: process.version, name: 'node', state: 'ok' },
        toolCheck('pnpm', 'pnpm', ['--version']),
        claudeCheck(),
        toolCheck('codex', 'codex', ['--version']),
        { detail: dataDir(), name: 'data dir', state: 'info' },
        daemonCheck(),
      ]);
      console.log(
        formatTable(
          ['check', 'status', 'detail'],
          checks.map(check => [check.name, STATE_LABEL[check.state], check.detail]),
        ),
      );
      if (checks.some(check => check.state === 'missing')) {
        console.log(`\n${dim('install what is missing, then run this again')}`);
        process.exitCode = 1;
      }
    });
}
