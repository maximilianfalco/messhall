import type { Ask } from '../../src/lib/claude.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { summarizeReport } from '../../tools/dev/commands/summarize.js';
import { scratchStore } from '../rooms/scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
  scratch.store.postMessage({ from: 'api', room: 'checkout', text: 'totals move to cents' });
});

afterEach(() => {
  scratch.cleanup();
});

const claude = vi.fn<Ask>(() => Promise.resolve({ costUsd: 0.00213, durationMs: 4200, text: 'Goal: cents.' }));
const plain = (report: string) => stripVTControlCharacters(report);

describe('summarizeReport', () => {
  it('runs one summary now and prints the prompt size, the summary, the cost and the time', async () => {
    const result = await summarizeReport({ claude, dataDir: scratch.dataDir, dryRun: false, room: 'checkout' });

    expect(result.code).toBe(0);
    expect(plain(result.report)).toMatch(/#checkout, 1 posts to summarize, prompt [\d,]+ chars/);
    expect(plain(result.report)).toContain('Goal: cents.');
    expect(plain(result.report)).toContain('summary #3, 12 chars, $0.0021, 4.2 s');
    expect(scratch.store.latestSummary('checkout')?.text).toBe('Goal: cents.');
  });

  it('prints the prompt only on a dry run and writes nothing', async () => {
    const result = await summarizeReport({ claude, dataDir: scratch.dataDir, dryRun: true, room: 'checkout' });

    expect(plain(result.report)).toContain('[#2 api] totals move to cents');
    expect(scratch.store.latestSummary('checkout')).toBeUndefined();
  });

  it('exits 1 with the claude error when the call fails', async () => {
    const failing = vi.fn<Ask>(() => Promise.reject(new Error('Claude Code did not answer.')));

    const result = await summarizeReport({
      claude: failing,
      dataDir: scratch.dataDir,
      dryRun: false,
      room: 'checkout',
    });

    expect(result.code).toBe(1);
    expect(plain(result.report)).toContain('Claude Code did not answer.');
  });

  it('exits 1 for a room that does not exist or a dir with no db', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'messhall-empty-'));

    const noRoom = await summarizeReport({ claude, dataDir: scratch.dataDir, dryRun: false, room: 'nope' });
    const noDb = await summarizeReport({ claude, dataDir: empty, dryRun: false, room: 'checkout' });

    expect([noRoom.code, plain(noRoom.report)]).toStrictEqual([1, '✖ no room #nope']);
    expect(noDb.code).toBe(1);
    expect(plain(noDb.report)).toContain('no messhall.db');
    rmSync(empty, { force: true, recursive: true });
  });
});
