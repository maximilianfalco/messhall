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
  // What each member does here. Stored member events get it too, so replay still parses.
  `
  ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'unassigned';
  UPDATE members SET role = 'orchestrator' WHERE name = 'orchestrator';
  UPDATE events SET payload = json_set(
    payload, '$.member.role', CASE json_extract(payload, '$.member.name') WHEN 'orchestrator' THEN 'orchestrator' ELSE 'unassigned' END
  ) WHERE kind = 'member';
  `,
  // What a role asks of its member, and who set it. Read through my_role and join, never on the wire.
  `
  ALTER TABLE members ADD COLUMN role_instructions TEXT;
  ALTER TABLE members ADD COLUMN role_set_by TEXT;
  `,
  // When a member went gone, so it drops out a few minutes later. Members already gone count from their last call.
  `
  ALTER TABLE members ADD COLUMN gone_at TEXT;
  UPDATE members SET gone_at = last_seen_at WHERE presence = 'gone';
  `,
  // Rooms no longer close at a post count. Stored room events lose the field too, so replay matches the contract.
  `
  ALTER TABLE rooms DROP COLUMN message_cap;
  UPDATE events SET payload = json_remove(payload, '$.room.message_cap') WHERE kind = 'room';
  `,
  // The agent this member traded too many lines with alone. Lines between them ring nobody until the human posts.
  `
  ALTER TABLE members ADD COLUMN paused_with TEXT;
  `,
  // Seats persist: gone is now away and never swept. The seat key hands a seat back only to its own agent.
  `
  UPDATE members SET presence = 'away' WHERE presence = 'gone';
  ALTER TABLE members DROP COLUMN gone_at;
  ALTER TABLE members ADD COLUMN seat_key TEXT;
  UPDATE events SET payload = json_set(payload, '$.member.presence', 'away')
    WHERE kind = 'member' AND json_extract(payload, '$.member.presence') = 'gone';
  UPDATE events SET payload = json_set(payload, '$.from', 'away')
    WHERE kind = 'presence' AND json_extract(payload, '$.from') = 'gone';
  UPDATE events SET payload = json_set(payload, '$.to', 'away')
    WHERE kind = 'presence' AND json_extract(payload, '$.to') = 'gone';
  `,
  // A muted member reads but cannot post, and nothing rings it, until the human or an orchestrator unmutes it.
  `
  ALTER TABLE members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
  `,
  // How to start the agent of a seat made ahead by an invite, as JSON. Null for a seat its agent made by joining.
  `
  ALTER TABLE members ADD COLUMN launch TEXT;
  `,
  // When a loop guard pause began, so it ends by itself and the next run counts from there. Older pauses lift.
  `
  ALTER TABLE members ADD COLUMN paused_at TEXT;
  `,
  // An agent's tool ask relayed for the human to answer. One row per room its seat is in, all under one id.
  `
  CREATE TABLE approvals (
    id TEXT NOT NULL,
    room_id TEXT NOT NULL REFERENCES rooms (id),
    member TEXT NOT NULL,
    session TEXT NOT NULL,
    request_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    description TEXT NOT NULL,
    input_preview TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    answered_at TEXT,
    PRIMARY KEY (id, room_id)
  );
  CREATE INDEX approvals_state ON approvals (state, created_at);
  `,
  // One line a member sets on itself, so progress lives on the seat, not in the transcript. Old events get nulls.
  `
  ALTER TABLE members ADD COLUMN status TEXT;
  ALTER TABLE members ADD COLUMN status_at TEXT;
  UPDATE events SET payload = json_set(payload, '$.member.status', json('null'), '$.member.status_at', json('null'))
    WHERE kind = 'member';
  `,
  // An agent's question to the human with 2 to 4 button labels, kept as JSON. The ask itself is a line in the room.
  `
  CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms (id),
    member TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    state TEXT NOT NULL,
    answer INTEGER,
    created_at TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE INDEX questions_state ON questions (state, created_at);
  `,
  // An agreement keyed by its proposal line, with the names to confirm and those who did as JSON.
  `
  CREATE TABLE agreements (
    id INTEGER PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms (id),
    proposer TEXT NOT NULL,
    text TEXT NOT NULL,
    with_names TEXT NOT NULL,
    confirmed TEXT NOT NULL,
    state TEXT NOT NULL,
    rejected_by TEXT,
    why TEXT,
    replaces INTEGER,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX agreements_room ON agreements (room_id, state);
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
