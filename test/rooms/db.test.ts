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
});
