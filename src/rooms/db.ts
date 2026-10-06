import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DB_BUSY_TIMEOUT_MS, DB_FILE } from '../config.js';
import { DbVersionError } from '../errors/DbVersionError.js';
import { clientType } from '../mcp/constants.js';

/** Schema steps in order. Never edit a shipped one, add the next. */
export const MIGRATIONS = [
  `
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    topic TEXT,
    created_at TEXT NOT NULL,
    closed_at TEXT,
    message_cap INTEGER NOT NULL
  );
  CREATE TABLE members (
    room_id TEXT NOT NULL REFERENCES rooms (id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    last_seen_at TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    presence TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, name)
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms (id),
    from_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    mentions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_room ON messages (room_id, id);
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX events_created_at ON events (created_at);
  `,
  // The last post a summary covers, so posts that land while it is written are not skipped.
  `
  ALTER TABLE messages ADD COLUMN covers_id INTEGER;
  `,
  // Old rooms were all made by an agent's first join. Stored room events get the fields too, so replay still parses.
  `
  ALTER TABLE rooms ADD COLUMN created_by TEXT NOT NULL DEFAULT 'messhall';
  ALTER TABLE rooms ADD COLUMN standing INTEGER NOT NULL DEFAULT 0;
  UPDATE rooms SET created_by = coalesce(
    (SELECT name FROM members WHERE room_id = rooms.id AND kind != 'human' ORDER BY joined_at LIMIT 1),
    'messhall'
  );
  UPDATE events SET payload = json_set(
    payload,
    '$.room.created_by', coalesce((SELECT created_by FROM rooms WHERE name = json_extract(payload, '$.room.name')), 'messhall'),
    '$.room.standing', json('false')
  ) WHERE kind = 'room';
  `,
  // Search reads the text from messages. Posts are never edited or deleted, so an insert trigger keeps it whole.
  `
  CREATE VIRTUAL TABLE messages_fts USING fts5(text, content = 'messages', content_rowid = 'id');
  INSERT INTO messages_fts (rowid, text) SELECT id, text FROM messages;
  CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
  END;
  UPDATE members SET presence = 'left' WHERE left_at IS NOT NULL;
  `,
  // The client an agent named at initialize. Stored member events get it too, so replay still parses.
  `
  ALTER TABLE members ADD COLUMN client_name TEXT;
  ALTER TABLE members ADD COLUMN client_version TEXT;
  UPDATE events SET payload = json_set(
    payload, '$.member.client_label', json('null'), '$.member.client_name', json('null'), '$.member.client_version', json('null')
  ) WHERE kind = 'member';
  `,
  // Who sent each post, kept on the post so a sender who left still shows its type. Old posts take it from the member.
  `
  ALTER TABLE messages ADD COLUMN from_kind TEXT;
  ALTER TABLE messages ADD COLUMN from_client_label TEXT;
  UPDATE messages SET (from_kind, from_client_label) = (
    SELECT kind, client_label(client_name) FROM members WHERE room_id = messages.room_id AND name = messages.from_name
  ) WHERE kind IN ('chat', 'done');
  UPDATE events SET payload = json_set(
    payload,
    '$.message.from_kind', (SELECT from_kind FROM messages WHERE id = json_extract(events.payload, '$.message.id')),
    '$.message.from_client_label', (SELECT from_client_label FROM messages WHERE id = json_extract(events.payload, '$.message.id'))
  ) WHERE kind = 'message';
  `,
];

function schemaVersion(db: DatabaseSync) {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
}

function migrate(db: DatabaseSync) {
  const found = schemaVersion(db);
  if (found > MIGRATIONS.length) throw new DbVersionError({ found, known: MIGRATIONS.length });
  MIGRATIONS.slice(found).forEach((sql, index) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${found + index + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
}

/** Opens `<dataDir>/messhall.db` in WAL mode with a busy timeout and brings the schema up to date. */
export function openDb({ dataDir }: { dataDir: string }) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, DB_FILE), { timeout: DB_BUSY_TIMEOUT_MS });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // A migration labels old posts with the same table the store uses.
  db.function('client_label', { deterministic: true }, name => (name === null ? null : clientType(String(name)).label));
  migrate(db);
  return db;
}
