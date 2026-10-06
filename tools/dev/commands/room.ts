import type { Command } from 'commander';

import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { probeHealth } from '../../../src/cli/status.js';
import { daemonUrl, dataDir as defaultDataDir, DB_FILE } from '../../../src/config.js';
import { bad, dim, formatTable } from '../lib/print.js';

const LAST_MESSAGES = 20;
const TEXT_MAX = 80;

const clip = (text: string) => {
  const flat = text.replaceAll('\n', ' ');
  return flat.length > TEXT_MAX ? `${flat.slice(0, TEXT_MAX - 1)}…` : flat;
};

/** A room's state and who made it, its members with client, presence and cursor, then its last messages.
 * Read only from `<dataDir>/messhall.db`. */
export function roomReport({
  dataDir,
  limit = LAST_MESSAGES,
  name,
}: {
  dataDir: string;
  limit?: number;
  name: string;
}) {
  const file = path.join(dataDir, DB_FILE);
  if (!existsSync(file)) return { code: 1, report: bad(`no ${DB_FILE} in ${dataDir}`) };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const room = db
      .prepare('SELECT id, closed_at, message_cap, created_by, standing FROM rooms WHERE name = ?')
      .get(name);
    if (!room) return { code: 1, report: bad(`no room #${name} in ${dataDir}`) };
    const roomId = String(room.id);
    const posts = db
      .prepare("SELECT count(*) AS n FROM messages WHERE room_id = ? AND kind IN ('chat', 'done')")
      .get(roomId);
    const members = db
      .prepare(
        'SELECT name, kind, client_name, client_version, role, presence, cursor, last_seen_at, left_at FROM members WHERE room_id = ? ORDER BY name',
      )
      .all(roomId);
    const messages = db
      .prepare(
        'SELECT id, from_name, kind, text, from_client_label FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?',
      )
      .all(roomId, limit)
      .toReversed();
    const state = room.closed_at === null ? 'open' : 'closed';
    const report = [
      `#${name} ${state}, ${Number(posts?.n)}/${Number(room.message_cap)} posts, made by ${String(room.created_by)}, ${room.standing === 1 ? 'standing' : 'not standing'}`,
      '',
      formatTable(
        ['member', 'kind', 'client', 'role', 'presence', 'cursor', 'last seen', 'left'],
        members.map(row => [
          String(row.name),
          String(row.kind),
          [row.client_name, row.client_version].filter(part => part !== null).join(' '),
          String(row.role),
          String(row.presence),
          String(row.cursor),
          String(row.last_seen_at),
          row.left_at === null ? '' : String(row.left_at),
        ]),
      ),
      '',
      formatTable(
        ['id', 'from', 'kind', 'text', 'type'],
        messages.map(row => [
          String(row.id),
          String(row.from_name),
          String(row.kind),
          clip(String(row.text)),
          String(row.from_client_label ?? ''),
        ]),
      ),
      '',
      dim(`last ${messages.length} messages from ${file}`),
    ];
    return { code: 0, report: report.join('\n') };
  } finally {
    db.close();
  }
}

/** Registers `room <name> [--url <url>] [--data-dir <d>]`. */
export function registerRoom(program: Command) {
  program
    .command('room <name>')
    .description("Show a room's members with client, presence and cursor, and its last messages.")
    .option('--url <url>', 'daemon to check is up', daemonUrl())
    .option('--data-dir <dir>', "the daemon's data dir, read only until the feed has a read route", defaultDataDir())
    .option('--limit <n>', 'how many messages to show', String(LAST_MESSAGES))
    .action(async (name: string, options: { dataDir: string; limit: string; url: string }) => {
      const probe = await probeHealth({ fetch, url: options.url });
      console.log(dim(probe.state === 'up' ? `daemon up on ${options.url}` : `daemon not answering on ${options.url}`));
      const result = roomReport({ dataDir: options.dataDir, limit: Number(options.limit), name });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
