import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DbVersionError } from '../../src/errors/DbVersionError.js';
import { MIGRATIONS, openDb } from '../../src/rooms/db.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-db-'));
});

afterEach(() => {
  rmSync(dataDir, { force: true, recursive: true });
});

const version = (db: ReturnType<typeof openDb>) => db.prepare('PRAGMA user_version').get()?.user_version;

describe('openDb', () => {
  it('opens messhall.db in WAL mode with every migration applied', () => {
    const db = openDb({ dataDir: path.join(dataDir, 'nested') });

    expect(existsSync(path.join(dataDir, 'nested', 'messhall.db'))).toBe(true);
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(version(db)).toBe(MIGRATIONS.length);
    db.close();
  });

  it('applies migrations once across reopen and keeps the rows', () => {
    const first = openDb({ dataDir });
    first.prepare("insert into events (kind, payload, created_at) values ('room', '{}', 'now')").run();
    first.close();

    const second = openDb({ dataDir });

    expect(version(second)).toBe(MIGRATIONS.length);
    expect(second.prepare('select count(*) as n from events').get()?.n).toBe(1);
    second.close();
  });

  it('backfills who made each room and the stored room events when it adds created_by', () => {
    const old = new DatabaseSync(path.join(dataDir, 'messhall.db'));
    old.exec(MIGRATIONS[0]!);
    old.exec('PRAGMA user_version = 1');
    old.exec(`
      INSERT INTO rooms (id, name, created_at, message_cap) VALUES ('r1', 'demo', 't0', 200);
      INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence) VALUES
        ('r1', 'human', 'human', 't0', 't0', 'idle'), ('r1', 'web', 'codex', 't2', 't2', 'active'),
        ('r1', 'api', 'claude', 't1', 't1', 'active');
      INSERT INTO events (kind, payload, created_at) VALUES ('room', '{"type":"room","change":"created","room":{"name":"demo"}}', 't0');
    `);
    old.close();

    const db = openDb({ dataDir });

    expect({ ...db.prepare('select created_by, standing from rooms').get() }).toStrictEqual({
      created_by: 'api',
      standing: 0,
    });
    expect(JSON.parse(String(db.prepare('select payload from events').get()?.payload)).room).toStrictEqual({
      created_by: 'api',
      name: 'demo',
      standing: false,
    });
    db.close();
  });

  it('refuses a db written by a newer messhall', () => {
    const db = openDb({ dataDir });
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();

    expect(() => openDb({ dataDir })).toThrow(DbVersionError);
  });

  it('gives a db from before summaries the covers_id column and keeps its messages', () => {
    const old = new DatabaseSync(path.join(dataDir, 'messhall.db'));
    old.exec(MIGRATIONS[0]!);
    old.exec("PRAGMA user_version = 1; INSERT INTO rooms VALUES ('r1', 'demo', NULL, 'now', NULL, 200)");
    old.exec(
      "INSERT INTO messages (room_id, from_name, kind, text, created_at) VALUES ('r1', 'api', 'chat', 'hi', 'now')",
    );
    old.close();

    const db = openDb({ dataDir });

    expect(
      db
        .prepare('select text, covers_id from messages')
        .all()
        .map(row => ({ ...row })),
    ).toStrictEqual([{ covers_id: null, text: 'hi' }]);
    db.close();
  });

  it('indexes the messages a db already had and marks members who left as left', () => {
    const old = new DatabaseSync(path.join(dataDir, 'messhall.db'));
    MIGRATIONS.slice(0, 3).forEach(sql => old.exec(sql));
    old.exec(`
      PRAGMA user_version = 3;
      INSERT INTO rooms (id, name, created_at, message_cap) VALUES ('r1', 'demo', 't0', 200);
      INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence, left_at) VALUES
        ('r1', 'api', 'claude', 't0', 't0', 'gone', 't1'), ('r1', 'web', 'codex', 't0', 't0', 'gone', NULL);
      INSERT INTO messages (room_id, from_name, kind, text, created_at) VALUES ('r1', 'api', 'chat', 'prices in cents', 't0');
    `);
    old.close();

    const db = openDb({ dataDir });

    expect(db.prepare("select rowid from messages_fts where messages_fts match 'cents'").all()).toHaveLength(1);
    expect(
      db
        .prepare('select name, presence from members order by name')
        .all()
        .map(row => ({ ...row })),
    ).toStrictEqual([
      { name: 'api', presence: 'left' },
      { name: 'web', presence: 'gone' },
    ]);
    db.close();
  });
  it('gives members and stored member events an empty client when it adds the client columns', () => {
    const old = new DatabaseSync(path.join(dataDir, 'messhall.db'));
    MIGRATIONS.slice(0, 4).forEach(sql => old.exec(sql));
    old.exec(`
      PRAGMA user_version = 4;
      INSERT INTO rooms (id, name, created_at, message_cap) VALUES ('r1', 'demo', 't0', 200);
      INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence) VALUES ('r1', 'api', 'claude', 't0', 't0', 'active');
      INSERT INTO events (kind, payload, created_at) VALUES
        ('member', '{"type":"member","change":"joined","room":"demo","member":{"name":"api"}}', 't0'),
        ('presence', '{"type":"presence","name":"api"}', 't0');
    `);
    old.close();

    const db = openDb({ dataDir });

    expect({ ...db.prepare('select client_name, client_version from members').get() }).toStrictEqual({
      client_name: null,
      client_version: null,
    });
    expect(
      db
        .prepare('select payload from events order by seq')
        .all()
        .map(row => JSON.parse(String(row.payload))),
    ).toStrictEqual([
      {
        change: 'joined',
        member: { client_label: null, client_name: null, client_version: null, name: 'api' },
        room: 'demo',
        type: 'member',
      },
      { name: 'api', type: 'presence' },
    ]);
    db.close();
  });

  it('stamps old messages and stored message events with the sender kind and label from its member', () => {
    const old = new DatabaseSync(path.join(dataDir, 'messhall.db'));
    MIGRATIONS.slice(0, 5).forEach(sql => old.exec(sql));
    old.exec(`
      PRAGMA user_version = 5;
      INSERT INTO rooms (id, name, created_at, message_cap) VALUES ('r1', 'demo', 't0', 200);
      INSERT INTO members (room_id, name, kind, joined_at, last_seen_at, presence, left_at, client_name) VALUES
        ('r1', 'web', 'other', 't0', 't0', 'left', 't1', 'opencode'), ('r1', 'ci', 'other', 't0', 't0', 'left', 't1', NULL);
      INSERT INTO messages (room_id, from_name, kind, text, created_at) VALUES
        ('r1', 'web', 'chat', 'hi', 't0'), ('r1', 'ci', 'chat', 'green', 't0'), ('r1', 'messhall', 'system', 'web left', 't1');
      INSERT INTO events (kind, payload, created_at) VALUES
        ('message', '{"type":"message","room":"demo","message":{"id":1,"from":"web"}}', 't0');
    `);
    old.close();

    const db = openDb({ dataDir });

    expect(
      db
        .prepare('select from_name, from_kind, from_client_label from messages order by id')
        .all()
        .map(row => ({ ...row })),
    ).toStrictEqual([
      { from_client_label: 'opencode', from_kind: 'other', from_name: 'web' },
      { from_client_label: null, from_kind: 'other', from_name: 'ci' },
      { from_client_label: null, from_kind: null, from_name: 'messhall' },
    ]);
    expect(JSON.parse(String(db.prepare('select payload from events').get()?.payload)).message).toStrictEqual({
      from: 'web',
      from_client_label: 'opencode',
      from_kind: 'other',
      id: 1,
    });
    db.close();
  });
});
