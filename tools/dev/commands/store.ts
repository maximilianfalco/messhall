import type { Command } from 'commander';

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DB_FILE } from '../../../src/config.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { bad, dim, formatTable } from '../lib/print.js';

import { queryDb } from './db.js';

const START = Date.parse('2026-01-01T09:00:00.000Z');
const ROOM = 'demo';

const outcome = (result: { ok: boolean; reason?: string }) => (result.ok ? 'ok' : `refused: ${result.reason}`);

/** Runs join, post, read, leave and the sweeps on a fresh store in `dataDir` with a fake clock, then prints its tables. */
export function scriptedRun({ dataDir }: { dataDir: string }) {
  if (existsSync(path.join(dataDir, DB_FILE))) {
    return { code: 1, report: bad(`${dataDir} already has a ${DB_FILE}, pick an empty dir`) };
  }
  let at = START;
  const tick = (ms: number) => {
    at += ms;
  };
  const db = openDb({ dataDir });
  const store = createRoomStore({ db, now: () => new Date(at) });
  const steps: string[][] = [];
  const step = (name: string, detail: string) => {
    steps.push([new Date(at).toISOString().slice(11, 19), name, detail]);
    tick(30_000);
  };
  try {
    step('join demo as ios (other)', outcome(store.joinRoom({ as: 'ios', kind: 'other', room: ROOM })));
    step('leave as ios', outcome(store.leaveRoom({ as: 'ios', room: ROOM })));
    tick(30 * 60_000);
    step('join demo as api (claude)', outcome(store.joinRoom({ as: 'api', kind: 'claude', room: ROOM })));
    step('join demo as web (codex)', outcome(store.joinRoom({ as: 'web', kind: 'codex', room: ROOM })));
    step('join demo as api again', outcome(store.joinRoom({ as: 'api', kind: 'other', room: ROOM })));
    const sent = store.postMessage({ from: 'api', room: ROOM, text: '@web the order schema has a currency field now' });
    step('post as api', sent.ok ? `#${sent.message.id}, mentions ${sent.message.mentions.join(', ')}` : outcome(sent));
    const read = store.readUnseen({ as: 'web', room: ROOM });
    step('read as web', read.ok ? `${read.messages.length} new, last #${read.messages.at(-1)?.id}` : outcome(read));
    step('post done as web', outcome(store.postMessage({ done: true, from: 'web', room: ROOM, text: 'form updated' })));
    step('leave as api', outcome(store.leaveRoom({ as: 'api', note: 'shipping', room: ROOM })));
    tick(3 * 60_000);
    const swept = store.sweepPresence().map(change => `${change.name} ${change.from} to ${change.to}`);
    step('sweep presence after 3 min', swept.join(', ') || 'no change');
    const dropped = store.clearStale().map(({ name }) => `${name} dropped out`);
    step('clear stale members', dropped.join(', ') || 'none');
  } finally {
    db.close();
  }
  const query = (sql: string) => queryDb({ dataDir, sql }).report;
  const report = [
    formatTable(['clock', 'step', 'result'], steps),
    '',
    query('select name, closed_at from rooms'),
    '',
    query('select name, kind, presence, cursor, done, left_at from members order by name'),
    '',
    query('select id, from_name, kind, mentions, text from messages order by id'),
    '',
    query('select kind, count(*) as events from events group by kind order by kind'),
    '',
    dim(`data dir ${dataDir}`),
  ];
  return { code: 0, report: report.join('\n') };
}

/** Registers `store [--data-dir <d>]`. */
export function registerStore(program: Command) {
  program
    .command('store')
    .description('Run a scripted join, post, read and leave on a scratch room store and print its tables.')
    .option('--data-dir <dir>', 'empty dir for the scratch db, a new temp dir by default')
    .action((options: { dataDir?: string }) => {
      const result = scriptedRun({ dataDir: options.dataDir ?? mkdtempSync(path.join(tmpdir(), 'messhall-store-')) });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
