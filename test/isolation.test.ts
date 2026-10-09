import { homedir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { dataDir, logDir } from '../src/config.js';

describe('test isolation', () => {
  it('keeps every test off the real tmux server, since a kill there ends every running agent', () => {
    expect(process.env.TMUX).toBe('');
    expect(process.env.TMUX_TMPDIR).toMatch(/messhall-vitest/);
  });

  it('keeps every test out of the real data dir and daemon log', () => {
    expect(dataDir()).not.toContain(homedir());
    expect(logDir()).not.toContain(homedir());
  });
});
