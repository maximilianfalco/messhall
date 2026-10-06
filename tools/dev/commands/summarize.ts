import type { Ask } from '../../../src/lib/claude.js';
import type { Command } from 'commander';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { claudeBin, dataDir as defaultDataDir, DB_FILE } from '../../../src/config.js';
import { askClaude } from '../../../src/lib/claude.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { nextSummaryPrompt, summarizeRoom } from '../../../src/rooms/summaries.js';
import { bad, dim, ok } from '../lib/print.js';

/** Runs one summary of `room` now against a daemon's data dir, or with `dryRun` prints the prompt only. */
export async function summarizeReport({
  claude,
  dataDir,
  dryRun,
  room,
}: {
  claude: Ask;
  dataDir: string;
  dryRun: boolean;
  room: string;
}) {
  if (!existsSync(path.join(dataDir, DB_FILE))) return { code: 1, report: bad(`no ${DB_FILE} in ${dataDir}`) };
  const db = openDb({ dataDir });
  try {
    const store = createRoomStore({ db, now: () => new Date() });
    const next = nextSummaryPrompt({ room, store });
    if (!next.ok) return { code: 1, report: bad(next.reason === 'no_room' ? `no room #${room}` : 'nothing new') };
    const header = dim(
      `#${room}, ${next.posts} posts to summarize, prompt ${next.prompt.length.toLocaleString('en-US')} chars`,
    );
    if (dryRun) return { code: 0, report: [header, '', next.prompt].join('\n') };
    const result = await summarizeRoom({ claude, room, store });
    if (!result.ok) {
      return { code: 1, report: [header, bad('error' in result ? result.error.message : result.reason)].join('\n') };
    }
    const { costUsd, durationMs, message } = result;
    const stats = `summary #${message.id}, ${message.text.length} chars, $${costUsd.toFixed(4)}, ${(durationMs / 1000).toFixed(1)} s`;
    return { code: 0, report: [header, '', message.text, '', ok(stats)].join('\n') };
  } finally {
    db.close();
  }
}

/** Registers `summarize <room> [--data-dir <d>] [--dry-run]`. */
export function registerSummarize(program: Command) {
  program
    .command('summarize <room>')
    .description("Run one rolling summary of a room now with claude on haiku, against a daemon's data dir.")
    .option('--data-dir <dir>', "the daemon's data dir", defaultDataDir())
    .option('--dry-run', 'print the prompt only, call nothing and write nothing', false)
    .action(async (room: string, options: { dataDir: string; dryRun: boolean }) => {
      const bin = claudeBin();
      const claude: Ask = ask => askClaude({ ...ask, bin });
      const result = await summarizeReport({ claude, dataDir: options.dataDir, dryRun: options.dryRun, room });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
