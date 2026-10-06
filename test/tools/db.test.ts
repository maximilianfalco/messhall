import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queryDb } from '../../tools/dev/commands/db.js';
import { scriptedRun } from '../../tools/dev/commands/store.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-dev-db-'));
});

afterEach(() => {
  rmSync(dataDir, { force: true, recursive: true });
});

describe('queryDb', () => {
  it('prints the rows of a query as a table', () => {
    scriptedRun({ dataDir });

    const result = queryDb({ dataDir, sql: "select name, kind from members where name != 'human' order by name" });

    expect(result.code).toBe(0);
    expect(stripVTControlCharacters(result.report).split('\n')).toStrictEqual([
      'name  kind',
      'api   claude',
      'web   codex',
      '',
      '2 rows',
    ]);
  });

  it('refuses to write', () => {
    scriptedRun({ dataDir });

    const result = queryDb({ dataDir, sql: 'delete from messages' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain('readonly');
  });

  it('says when there is no db', () => {
    const result = queryDb({ dataDir, sql: 'select 1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain(`no messhall.db in ${dataDir}`);
  });
});

describe('scriptedRun', () => {
  it('joins, posts, reads and leaves, then prints the tables', () => {
    const result = scriptedRun({ dataDir });
    const report = stripVTControlCharacters(result.report);

    expect(result.code).toBe(0);
    expect(report).toContain('read as web');
    expect(report).toContain('@web the order schema has a currency field now');
    expect(report).toMatch(/api\s+claude\s+gone/);
  });

  it('refuses a dir that already holds a db', () => {
    scriptedRun({ dataDir });

    const again = scriptedRun({ dataDir });

    expect(again.code).toBe(1);
    expect(stripVTControlCharacters(again.report)).toContain('already has a messhall.db');
  });
});
