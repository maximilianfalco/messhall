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

/** Gemini CLI's user settings. `GEMINI_CLI_HOME` stands in for the home dir, as it does for gemini itself. */
export function geminiSettingsPath() {
  return path.join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini', 'settings.json');
}

/** Codex's shared app-server control socket. `MESSHALL_CODEX_SOCKET` wins, then `CODEX_HOME`, as for codex itself. */
export function codexControlSocket() {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  return process.env.MESSHALL_CODEX_SOCKET || path.join(codexHome, 'app-server-control', 'app-server-control.sock');
}

/** Where the running scan looks: Claude Code's session list (`CLAUDE_CONFIG_DIR` wins, as for claude) and
 * plain codex in ps. `MESSHALL_CLAUDE_SESSIONS` points a scratch daemon at fake sessions and skips ps. */
export function runningSources() {
  const scratch = process.env.MESSHALL_CLAUDE_SESSIONS;
  if (scratch) return { claudeDir: scratch, plainCodex: false };
  return {
    claudeDir: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), 'sessions'),
    plainCodex: true,
  };
}

/** Where rooms and keys live. `MESSHALL_HOME` wins so tests and tapes never touch the real data. */
export function dataDir() {
  return process.env.MESSHALL_HOME || path.join(homedir(), 'Library', 'Application Support', 'messhall');
}

/** True when `MESSHALL_SUMMARIES` is `off`, so a scratch daemon never pays claude for a room summary. */
export function summariesOff() {
  return process.env.MESSHALL_SUMMARIES === 'off';
}

/** Where the daemon writes its log file. Under `MESSHALL_HOME` when set, so tests keep logs out of the real dir. */
export function logDir() {
  const home = process.env.MESSHALL_HOME;
  return home ? path.join(home, 'logs') : path.join(homedir(), 'Library', 'Logs', 'messhall');
}

/** A binary: the first on PATH, then the usual install spots, since launchd gives the daemon a bare PATH.
 * The bare name when none is found, so the spawn error names it. */
export function findBin(name: string, { exists = existsSync }: { exists?: (file: string) => boolean } = {}) {
  const home = homedir();
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(dir => path.join(dir, name));
  const spots = [
    path.join(home, '.local', 'bin', name),
    path.join('/opt/homebrew/bin', name),
    path.join('/usr/local/bin', name),
    path.join(home, '.claude', 'local', name),
  ];
  return [...onPath, ...spots].find(file => exists(file)) ?? name;
}

/** The claude binary, found as `findBin` does. */
export const claudeBin = (options: { exists?: (file: string) => boolean } = {}) => findBin('claude', options);

export const READ_LIMIT = 50;
export const IDLE_AFTER_MS = 2 * 60_000;
export const AWAY_AFTER_MS = 30 * 60_000;
export const RECONNECT_MS = 2 * 60_000;
// A seat keyed by a join's seat token goes to anyone after this long away with no live session, so a lost token frees it.
export const SEAT_TOKEN_FREE_AFTER_MS = 30 * 60_000;
// A member who left this long drops out of the room, so standing rooms do not pile up old agents.
export const STALE_AFTER_MS = 5 * 60_000;
// A seat that said done and has been away this long leaves on its own, so finished agents do not pile up.
export const DONE_AWAY_LEAVE_MS = 60 * 60_000;
// An invite whose agent never made a call this long drops, so a failed launch does not hold the name.
export const INVITE_TTL_MS = 10 * 60_000;
// A tool ask nobody answers this long is denied, so a forgotten card cannot hold an agent forever.
export const APPROVAL_TTL_MS = 10 * 60_000;
// Claude Code caps each field near 3,500 chars, but a preview holds several fields.
export const APPROVAL_TEXT_MAX = 8000;
// An open question nobody answers this long is closed, so its agent carries on with its own call.
export const QUESTION_TTL_MS = 30 * 60_000;
// A review request nobody answered in this long goes to any free reviewer.
export const REVIEW_STALE_MS = 10 * 60_000;
// Five minutes after that ring, the request goes to the other reviewers in one line.
export const REVIEW_HANDOFF_MS = 15 * 60_000;
// An older request is left alone, so a daemon back from a long stop does not nudge old news.
export const REVIEW_NUDGE_WINDOW_MS = 60 * 60_000;
// A note for a name not in the room waits this long for that name to join.
export const NOTE_HOLD_MS = 24 * 60 * 60_000;
// How long a sender can still edit or take back its last post.
export const EDIT_WINDOW_MS = 5 * 60_000;
// Codex reads its first prompt and joins before its seat is taken, which is slower than a claude connect.
export const SPAWN_READY_MS = 2 * 60_000;
// Seats an orchestrator may have spawned in one room at once, and how fast it may spawn them.
// The human is never capped, so past these it asks the human instead.
export const SPAWN_SEAT_CAP = 6;
export const SPAWN_RATE_MAX = 3;
export const SPAWN_RATE_WINDOW_MS = 60_000;
// A capped orchestrator that keeps asking rings the human at most this often.
export const SPAWN_CAP_RING_EVERY_MS = 10 * 60_000;
// A spawned seat whose session dies gets this many restarts, with a wait that doubles from the backoff.
// One that stays up for the reset window starts over with a clean count.
export const HEAL_TRIES = 3;
export const HEAL_BACKOFF_MS = 30_000;
export const HEAL_RESET_MS = 10 * 60_000;
// A session with no stream and no request this long is dead: its client most likely died.
export const SESSION_DEAD_MS = 60_000;
// A channel session that has not answered its test ring this long reads as no doorbell.
export const DOORBELL_CHECK_MS = 30_000;
export const EVENT_KEEP_MS = 7 * 24 * 60 * 60_000;
export const DB_FILE = 'messhall.db';
export const DB_BUSY_TIMEOUT_MS = 5000;
export const SWEEP_EVERY_MS = 15_000;
export const HEALTH_TIMEOUT_MS = 1000;
export const RING_BATCH_MS = 3000;
export const RING_THROTTLE_MS = 20_000;
export const RING_ACTIVE_HOLD_MS = 5000;
// Two agents trading 12 lines alone in 2 minutes, or 40 at any pace, pause their doorbells for 5 minutes.
// A real discussion has work between lines, a runaway loop does not.
export const LOOP_GUARD_LINES = 12;
export const LOOP_GUARD_WITHIN_MS = 2 * 60_000;
export const LOOP_GUARD_BACKSTOP = 40;
export const LOOP_GUARD_PAUSE_MS = 5 * 60_000;
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
