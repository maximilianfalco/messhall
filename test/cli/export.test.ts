import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runExport } from '../../src/cli/export.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  vi.stubEnv('TZ', 'UTC');
  feed = await feedServer();
  feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
  ['first', 'second', 'third', 'fourth'].forEach(text => {
    feed.scratch.store.postMessage({ from: 'api', room: 'checkout', text });
  });
});

afterEach(async () => {
  await feed.close();
  vi.unstubAllEnvs();
});

const exportRoom = (overrides: Partial<Parameters<typeof runExport>[0]> = {}) =>
  runExport({ dataDir: feed.scratch.dataDir, fetch, room: 'checkout', url: feed.url, ...overrides });

const messageLines = (markdown: string) => markdown.split('\n').filter(line => line.startsWith('- **'));

describe('runExport', () => {
  it('stitches every page in order', async () => {
    const result = await exportRoom({ pageSize: 2 });

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/^# #checkout\n/);
    expect(messageLines(result.output)).toStrictEqual([
      '- **10:00** *api joined*',
      '- **10:00** `api`: first',
      '- **10:00** `api`: second',
      '- **10:00** `api`: third',
      '- **10:00** `api`: fourth',
    ]);
  });

  it('starts after the since id', async () => {
    const page = feed.scratch.store.listMessages({ limit: 10, room: 'checkout' });
    const second = page.ok ? page.messages.find(item => item.text === 'second') : undefined;

    const result = await exportRoom({ pageSize: 2, since: second?.id });

    expect(messageLines(result.output)).toStrictEqual(['- **10:00** `api`: third', '- **10:00** `api`: fourth']);
  });

  it('writes the file and says where', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'messhall-export-'));
    const out = path.join(dir, 'checkout.md');

    const result = await exportRoom({ out });

    expect(result).toStrictEqual({ code: 0, output: `wrote 5 messages to ${out}` });
    expect(readFileSync(out, 'utf8')).toMatch(/^# #checkout\n[\s\S]*- \*\*10:00\*\* `api`: fourth\n$/);
    rmSync(dir, { recursive: true });
  });

  it('says the daemon is down in one line', async () => {
    const result = await exportRoom({ url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    );
  });

  it('says when there is no such room', async () => {
    const result = await exportRoom({ room: 'nope' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe('no room #nope');
  });
});
