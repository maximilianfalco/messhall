import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { logDir } from '../config.js';

export const LOG_FILE = 'daemon.log';

interface ErrorExtras {
  [key: string]: unknown;
  message: string;
}

function write(entry: Record<string, unknown>) {
  const line = `${JSON.stringify(entry)}\n`;
  process.stderr.write(line);
  const dir = logDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, LOG_FILE), line);
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
