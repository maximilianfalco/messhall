import type { Launchctl } from '../lib/launchctl.js';
import type { Command } from 'commander';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchAgentPath, logDir } from '../config.js';
import { systemLaunchctl } from '../lib/launchctl.js';
import { LOG_FILE } from '../lib/logger.js';
import { launchAgentPlist } from '../lib/plist.js';

/** Writes the LaunchAgent and loads it. A rerun boots the old one out first, so it reloads.
 * With `print` it only shows the plist and the commands. Without a build it does nothing. */
export async function runInstall({
  cliPath,
  launchctl,
  logPath,
  nodePath,
  plistPath,
  print,
}: {
  cliPath: string;
  launchctl: Launchctl;
  logPath: string;
  nodePath: string;
  plistPath: string;
  print: boolean;
}) {
  if (!existsSync(cliPath)) return { code: 1, report: `no build at ${cliPath}. run pnpm build first` };
  const plist = launchAgentPlist({ cliPath, logPath, nodePath });
  if (print) {
    const report = [
      `# would write ${plistPath}`,
      plist,
      '# would run',
      launchctl.line('bootout'),
      launchctl.line('bootstrap'),
    ];
    return { code: 0, report: report.join('\n') };
  }
  // A first install has nothing to boot out, so its failure is fine.
  await launchctl.bootout();
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(plistPath, plist);
  const boot = await launchctl.bootstrap();
  if (boot.code !== 0) return { code: 1, report: `launchctl bootstrap failed: ${boot.stderr.trim()}` };
  return {
    code: 0,
    report: `installed ${plistPath}\nmesshall runs now and at every login. check it with messhall status`,
  };
}

// Walks up to package.json, so this works from src under tsx and from dist once built.
function packageRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

/** Registers `install [--print]`. */
export function registerInstall(program: Command) {
  program
    .command('install')
    .description('Write the LaunchAgent that keeps the daemon running and load it. Rerun after a node upgrade.')
    .option('--print', 'only print the plist and the launchctl commands')
    .action(async (options: { print?: boolean }) => {
      const result = await runInstall({
        cliPath: path.join(packageRoot(), 'dist', 'src', 'cli.js'),
        launchctl: systemLaunchctl(),
        logPath: path.join(logDir(), LOG_FILE),
        nodePath: process.execPath,
        plistPath: launchAgentPath(),
        print: Boolean(options.print),
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
