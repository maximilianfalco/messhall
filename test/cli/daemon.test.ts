import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDaemon } from '../../src/cli/daemon.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-cli-daemon-'));
  vi.stubEnv('MESSHALL_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

describe('runDaemon', () => {
  it('exits 1 and names the pid when the port is taken', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const holder = createServer();
    await new Promise<void>(resolve => {
      holder.listen(0, '127.0.0.1', resolve);
    });
    const address = holder.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const result = await runDaemon({ dataDir: home, findPortHolder: () => Promise.resolve('4242'), port });

    const said = `port ${port} is taken by pid 4242. stop it or set MESSHALL_PORT`;
    expect(result.code).toBe(1);
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain(said);
    expect(readFileSync(path.join(home, 'logs', 'daemon.log'), 'utf8')).toContain(said);
    await new Promise(resolve => {
      holder.close(resolve);
    });
  });
});
