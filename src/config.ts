import { homedir } from 'node:os';
import path from 'node:path';

import { PortConfigError } from './errors/PortConfigError.js';

// Kept in step with package.json by a test, so the built bin needs no file read.
export const CLI_VERSION = '0.1.0';

export const DEFAULT_PORT = 7707;
export const DAEMON_HOST = '127.0.0.1';
export const LAUNCH_AGENT_LABEL = 'dev.messhall.daemon';
// Node 22 warns on every node:sqlite import, so every daemon run carries this flag.
export const NODE_QUIET_FLAG = '--disable-warning=ExperimentalWarning';

/** The port the daemon binds on 127.0.0.1. `MESSHALL_PORT` wins, and a bad value throws. */
export function daemonPort() {
  const raw = process.env.MESSHALL_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new PortConfigError({ raw });
  return port;
}

/** The daemon's base url on the configured port. */
export function daemonUrl() {
  return `http://${DAEMON_HOST}:${daemonPort()}`;
}

/** Where `messhall install` writes the LaunchAgent plist. */
export function launchAgentPath() {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

/** Where rooms and keys live. `MESSHALL_HOME` wins so tests and tapes never touch the real data. */
export function dataDir() {
  return process.env.MESSHALL_HOME || path.join(homedir(), 'Library', 'Application Support', 'messhall');
}

/** Where the daemon writes its log file. Under `MESSHALL_HOME` when set, so tests keep logs out of the real dir. */
export function logDir() {
  const home = process.env.MESSHALL_HOME;
  return home ? path.join(home, 'logs') : path.join(homedir(), 'Library', 'Logs', 'messhall');
}

export const DEFAULT_MESSAGE_CAP = 200;
export const CAP_WARN_RATIO = 0.8;
export const READ_LIMIT = 50;
export const IDLE_AFTER_MS = 2 * 60_000;
export const GONE_AFTER_MS = 30 * 60_000;
export const EVENT_KEEP_MS = 7 * 24 * 60 * 60_000;
export const DB_FILE = 'messhall.db';
export const DB_BUSY_TIMEOUT_MS = 5000;
export const PRESENCE_SWEEP_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 1000;
