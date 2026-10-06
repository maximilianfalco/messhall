import type { Command } from 'commander';

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { logDir } from '../config.js';
import { LOG_FILE } from '../lib/logger.js';

const TAIL_LINES = '100';

/** Registers `logs [-f]`. */
export function registerLogs(program: Command) {
  program
    .command('logs')
    .description('Print the end of the daemon log.')
    .option('-f, --follow', 'keep printing new lines')
    .action((options: { follow?: boolean }) => {
      const file = path.join(logDir(), LOG_FILE);
      if (!existsSync(file)) {
        console.log(`no log yet at ${file}`);
        process.exitCode = 1;
        return;
      }
      const child = spawn('tail', ['-n', TAIL_LINES, ...(options.follow ? ['-f'] : []), file], { stdio: 'inherit' });
      child.on('close', code => {
        process.exitCode = code ?? 0;
      });
    });
}
