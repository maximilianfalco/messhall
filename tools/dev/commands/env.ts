import type { Command } from 'commander';

import { hasChannels, readClaudeEntry, readCodexEntry } from '../../../src/cli/mcp.js';
import { probeHealth } from '../../../src/cli/status.js';
import { codexConfigPath, daemonUrl, dataDir } from '../../../src/config.js';
import { runCommand } from '../../../src/lib/run.js';
import { REPO_ROOT } from '../lib/paths.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';
import { run } from '../lib/run.js';

type EnvState = 'info' | 'missing' | 'ok';

interface EnvCheck {
  detail: string;
  name: string;
  state: EnvState;
}

const STATE_LABEL: Record<EnvState, string> = { info: dim('info'), missing: bad('missing'), ok: ok('ok') };

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

// A missing entry is normal before messhall mcp install, so it never fails the command.
async function entryChecks() {
  const claude = await readClaudeEntry(runCommand);
  const codexFile = codexConfigPath();
  const codex = readCodexEntry(codexFile) !== null;
  const checks: EnvCheck[] = [
    { detail: claude ? `present, ${claude.url}` : 'missing', name: 'claude entry', state: claude ? 'ok' : 'info' },
    { detail: `${codex ? 'present' : 'missing'} in ${codexFile}`, name: 'codex entry', state: codex ? 'ok' : 'info' },
  ];
  return checks;
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
    .description('Show node, pnpm, claude (and channels), codex, the data dir, the daemon and both messhall entries.')
    .action(async () => {
      const base: EnvCheck[] = await Promise.all([
        { detail: process.version, name: 'node', state: 'ok' },
        toolCheck('pnpm', 'pnpm', ['--version']),
        claudeCheck(),
        toolCheck('codex', 'codex', ['--version']),
        { detail: dataDir(), name: 'data dir', state: 'info' },
        daemonCheck(),
      ]);
      const checks = [...base, ...(await entryChecks())];
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
