import type { Daemon } from '../../src/daemon/server.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPost } from '../../src/cli/post.js';
import { startDaemon } from '../../src/daemon/server.js';
import { roomReport } from '../../tools/dev/commands/room.js';

let home: string;
let daemon: Daemon;

beforeEach(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-post-'));
  vi.stubEnv('MESSHALL_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const started = await startDaemon({ dataDir: home, now: () => new Date(), port: 0 });
  if (!started.ok) throw new Error(started.reason);
  ({ daemon } = started);
});

afterEach(async () => {
  await daemon.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

const post = (overrides: Partial<Parameters<typeof runPost>[0]> = {}) =>
  runPost({ as: 'ci', dataDir: home, room: 'checkout', text: 'build is green', url: daemon.url, ...overrides });

const room = () => stripVTControlCharacters(roomReport({ dataDir: home, name: 'checkout' }).report);

describe('runPost', () => {
  it('posts as the name, prints the message id and leaves the room', async () => {
    const result = await post();

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/^\d+$/);
    expect(room()).toMatch(new RegExp(`${result.output} +ci +chat +build is green`));
    expect(room()).toMatch(/system +ci left/);
    expect(room()).not.toContain('is away');
  });

  it('names itself messhall-cli, so the room labels it a script', async () => {
    const result = await post();

    expect(room()).toMatch(/ci +other +messhall-cli /);
    expect(room()).toMatch(new RegExp(`${result.output} +ci +chat +build is green`));
  });

  it('posts a done line with done', async () => {
    const result = await post({ done: true });

    expect(room()).toMatch(new RegExp(`${result.output} +ci +done +build is green`));
  });

  it('says the daemon is down in one line', async () => {
    const result = await post({ url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    );
  });

  it('passes on a refusal in one line', async () => {
    const result = await post({ text: 'x'.repeat(4001) });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall refused the post: too long (4001 chars). Write it to a file and post the path.',
    );
  });
});
