import { homedir } from 'node:os';
import path from 'node:path';

// Kept in step with package.json by a test, so the built bin needs no file read.
export const CLI_VERSION = '0.1.0';

export const DEFAULT_PORT = 7707;

/** Where rooms and keys live. `MESSHALL_HOME` wins so tests and tapes never touch the real data. */
export function dataDir() {
  return process.env.MESSHALL_HOME || path.join(homedir(), 'Library', 'Application Support', 'messhall');
}

/** Where the daemon writes its log file. */
export function logDir() {
  return path.join(homedir(), 'Library', 'Logs', 'messhall');
}
