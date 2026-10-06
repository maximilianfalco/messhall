import type { Command } from 'commander';

import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { dataDir as defaultDataDir, DB_FILE } from '../../../src/config.js';
import { bad, dim, formatTable } from '../lib/print.js';

const CELL_MAX = 60;

function cell(value: unknown) {
  const text = value === null ? 'null' : String(value).replaceAll('\n', ' ');
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX - 1)}…` : text;
}

/** Rows of `sql` against `<dataDir>/messhall.db` as a table. The db opens read-only, so a write fails. */
export function queryDb({ dataDir, sql }: { dataDir: string; sql: string }) {
  const file = path.join(dataDir, DB_FILE);
  if (!existsSync(file)) return { code: 1, report: bad(`no ${DB_FILE} in ${dataDir}`) };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(sql).all();
    const columns = Object.keys(rows[0] ?? {});
    const table = columns.length
      ? formatTable(
          columns,
          rows.map(row => columns.map(column => cell(row[column]))),
        )
      : '';
    return {
      code: 0,
      report: [table, '', dim(`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`)].join('\n').trimStart(),
    };
  } catch (error) {
    return { code: 1, report: bad(error instanceof Error ? error.message : String(error)) };
  } finally {
    db.close();
  }
}

/** Registers `db "<sql>" [--data-dir <d>]`. */
export function registerDb(program: Command) {
  program
    .command('db <sql>')
    .description('Run a read-only query against a messhall.db and print the rows.')
    .option('--data-dir <dir>', 'dir that holds messhall.db', defaultDataDir())
    .action((sql: string, options: { dataDir: string }) => {
      const result = queryDb({ dataDir: options.dataDir, sql });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
