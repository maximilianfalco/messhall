import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../src/lib/logger.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-log-'));
  vi.stubEnv('MESSHALL_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

describe('logger', () => {
  it('writes an error as one JSON line to stderr and the log file', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.error(new TypeError('boom'), { message: 'listener failed', room: 'demo' });

    const line = readFileSync(path.join(home, 'logs', 'daemon.log'), 'utf8');
    expect(JSON.parse(line)).toMatchObject({
      error: { message: 'boom', name: 'TypeError' },
      level: 'error',
      message: 'listener failed',
      room: 'demo',
    });
    expect(stderr).toHaveBeenCalledWith(line);
  });

  it('writes info lines the same way', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('daemon up', { port: 7707 });

    const line = readFileSync(path.join(home, 'logs', 'daemon.log'), 'utf8');
    expect(JSON.parse(line)).toMatchObject({ level: 'info', message: 'daemon up', port: 7707 });
  });

  it('writes each line once when stderr already is the log file', () => {
    const file = path.join(home, 'logs', 'daemon.log');
    mkdirSync(path.dirname(file));
    const fd = openSync(file, 'a');
    const script = "const { logger } = await import('./src/lib/logger.ts'); logger.info('once');";

    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, MESSHALL_HOME: home },
      stdio: ['ignore', 'ignore', fd],
    });
    closeSync(fd);

    expect(child.status).toBe(0);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.map(line => (JSON.parse(line) as { message: string }).message)).toStrictEqual(['once']);
  });
});
