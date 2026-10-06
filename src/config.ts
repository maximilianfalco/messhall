import { existsSync } from 'node:fs';
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

/** Codex's user config. `CODEX_HOME` wins, as it does for codex itself. */
export function codexConfigPath() {
  return path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml');
}

/** Codex's shared app-server control socket. `MESSHALL_CODEX_SOCKET` wins, then `CODEX_HOME`, as for codex itself. */
export function codexControlSocket() {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  return process.env.MESSHALL_CODEX_SOCKET || path.join(codexHome, 'app-server-control', 'app-server-control.sock');
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

/**
 * The claude binary: the first on PATH, then the usual install spots, since launchd gives the daemon
 * a bare PATH. The bare name when none is found, so the spawn error names it.
 */
export function claudeBin({ exists = existsSync }: { exists?: (file: string) => boolean } = {}) {
  const home = homedir();
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(dir => path.join(dir, 'claude'));
  const spots = [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    path.join(home, '.claude', 'local', 'claude'),
  ];
  return [...onPath, ...spots].find(file => exists(file)) ?? 'claude';
}

export const DEFAULT_MESSAGE_CAP = 200;
export const CAP_WARN_RATIO = 0.8;
export const READ_LIMIT = 50;
export const IDLE_AFTER_MS = 2 * 60_000;
export const GONE_AFTER_MS = 30 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const EVENT_KEEP_MS = 7 * 24 * 60 * 60_000;
export const DB_FILE = 'messhall.db';
export const DB_BUSY_TIMEOUT_MS = 5000;
export const PRESENCE_SWEEP_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 1000;
export const RING_BATCH_MS = 3000;
export const RING_THROTTLE_MS = 20_000;
export const RING_ACTIVE_HOLD_MS = 5000;
export const CODEX_REQUEST_TIMEOUT_MS = 5000;
export const CODEX_RECONNECT_MIN_MS = 500;
export const CODEX_RECONNECT_MAX_MS = 30_000;
export const FEED_SNAPSHOT_MESSAGES = 50;
export const FEED_PAGE_DEFAULT = 50;
export const FEED_PAGE_MAX = 200;
export const SEARCH_LIMIT = 50;
export const FEED_PING_MS = 15_000;
export const FEED_STALL_MS = 30_000;
export const FEED_BODY_MAX_BYTES = 64 * 1024;
export const WATCH_RECONNECT_MS = 1000;
export const SUMMARY_FIRST_AT = 60;
export const SUMMARY_EVERY = 40;
export const SUMMARY_MAX_CHARS = 1200;
export const SUMMARY_TIMEOUT_MS = 120_000;
