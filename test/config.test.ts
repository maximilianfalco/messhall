import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLI_VERSION,
  claudeBin,
  daemonPort,
  dataDir,
  DEFAULT_PORT,
  launchAgentPath,
  logDir,
  runningSources,
  summariesOff,
} from '../src/config.js';

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

  it('scans claude sessions in the claude config dir and plain codex by default', () => {
    vi.stubEnv('MESSHALL_CLAUDE_SESSIONS', '');
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/Users/someone/.claude-work');
    expect(runningSources()).toStrictEqual({ claudeDir: '/Users/someone/.claude-work/sessions', plainCodex: true });
  });

  it('scans only MESSHALL_CLAUDE_SESSIONS when it is set, so a scratch daemon never lists real sessions', () => {
    vi.stubEnv('MESSHALL_CLAUDE_SESSIONS', '/tmp/messhall-shot/claude-sessions');
    expect(runningSources()).toStrictEqual({ claudeDir: '/tmp/messhall-shot/claude-sessions', plainCodex: false });
  });

  it('uses MESSHALL_PORT when it is set', () => {
    vi.stubEnv('MESSHALL_PORT', '7797');
    expect(daemonPort()).toBe(7797);
  });

  it('uses the default port when MESSHALL_PORT is empty', () => {
    vi.stubEnv('MESSHALL_PORT', '');
    expect(daemonPort()).toBe(DEFAULT_PORT);
  });

  it.each(['abc', '-1', '65536', '77.5'])('refuses MESSHALL_PORT %s', port => {
    vi.stubEnv('MESSHALL_PORT', port);
    expect(() => daemonPort()).toThrow(/MESSHALL_PORT/);
  });

  it('turns summaries off only when MESSHALL_SUMMARIES is off', () => {
    vi.stubEnv('MESSHALL_SUMMARIES', 'off');
    expect(summariesOff()).toBe(true);
    vi.stubEnv('MESSHALL_SUMMARIES', '');
    expect(summariesOff()).toBe(false);
    vi.stubEnv('MESSHALL_SUMMARIES', 'on');
    expect(summariesOff()).toBe(false);
  });

  it('puts the LaunchAgent in the user Library', () => {
    vi.stubEnv('HOME', '/Users/someone');
    expect(launchAgentPath()).toBe('/Users/someone/Library/LaunchAgents/dev.messhall.daemon.plist');
  });

  it('finds claude on PATH first', () => {
    vi.stubEnv('PATH', '/usr/bin:/opt/tools/bin');
    vi.stubEnv('HOME', '/Users/someone');
    const found = new Set(['/opt/tools/bin/claude', '/Users/someone/.local/bin/claude']);

    expect(claudeBin({ exists: file => found.has(file) })).toBe('/opt/tools/bin/claude');
  });

  it.each([
    ['/Users/someone/.local/bin/claude'],
    ['/opt/homebrew/bin/claude'],
    ['/Users/someone/.claude/local/claude'],
  ])('falls back to %s when PATH has no claude, as under launchd', file => {
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.stubEnv('HOME', '/Users/someone');

    expect(claudeBin({ exists: candidate => candidate === file })).toBe(file);
  });

  it('gives the bare name when claude is nowhere, so the spawn error names it', () => {
    vi.stubEnv('PATH', '/usr/bin');

    expect(claudeBin({ exists: () => false })).toBe('claude');
  });
});
