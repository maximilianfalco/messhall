import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
});
