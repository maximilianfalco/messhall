import { appendFileSync, fstatSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { logDir } from '../config.js';

export const LOG_FILE = 'daemon.log';

interface ErrorExtras {
  [key: string]: unknown;
  message: string;
}

// Under launchd, stderr already goes to the log file, so a second write would double every line.
function stderrIsFile(file: string) {
  try {
    const stderr = fstatSync(process.stderr.fd);
    const target = statSync(file);
    return stderr.dev === target.dev && stderr.ino === target.ino;
  } catch {
    return false;
  }
}

function write(entry: Record<string, unknown>) {
  const line = `${JSON.stringify(entry)}\n`;
  process.stderr.write(line);
  const dir = logDir();
  const file = path.join(dir, LOG_FILE);
  if (stderrIsFile(file)) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, line);
}

/** One JSON line per entry, to stderr and the daemon log. stdout belongs to MCP, so it is never used. */
export const logger = {
  error(error: Error, extras: ErrorExtras) {
    write({ level: 'error', ...extras, error: { message: error.message, name: error.name, stack: error.stack } });
  },
  info(message: string, extras: Record<string, unknown> = {}) {
    write({ level: 'info', message, ...extras });
  },
};
