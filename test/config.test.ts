import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLI_VERSION, dataDir, DEFAULT_PORT, logDir } from '../src/config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('config', () => {
  it('listens on port 7707 by default', () => {
    expect(DEFAULT_PORT).toBe(7707);
  });

  it('reports the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('keeps data under MESSHALL_HOME when it is set', () => {
    vi.stubEnv('MESSHALL_HOME', '/tmp/messhall-test-home');
    expect(dataDir()).toBe('/tmp/messhall-test-home');
  });

  it('keeps data in Application Support when MESSHALL_HOME is empty', () => {
    vi.stubEnv('MESSHALL_HOME', '');
    vi.stubEnv('HOME', '/Users/someone');
    expect(dataDir()).toBe('/Users/someone/Library/Application Support/messhall');
  });

  it('writes logs to Library/Logs', () => {
    vi.stubEnv('MESSHALL_HOME', '');
    vi.stubEnv('HOME', '/Users/someone');
    expect(logDir()).toBe('/Users/someone/Library/Logs/messhall');
  });

  it('keeps logs under MESSHALL_HOME when it is set', () => {
    vi.stubEnv('MESSHALL_HOME', '/tmp/messhall-test-home');
    expect(logDir()).toBe('/tmp/messhall-test-home/logs');
  });
});
