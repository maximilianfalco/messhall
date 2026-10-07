import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runStatus } from '../../src/cli/status.js';

const FIXTURE = readFileSync(new URL('fixtures/dev.messhall.daemon.plist', import.meta.url), 'utf8');
const URL_BASE = 'http://127.0.0.1:7797';

const CURRENT = { commit: 'b'.repeat(40), committed_at: '2026-10-07T08:00:00Z' };
const STALE = { commit: 'a'.repeat(40), committed_at: '2026-10-07T01:00:00Z' };
const INSTALLED = { build: CURRENT, contract: 5 };
const stamped = (build: typeof CURRENT) => () =>
  Promise.resolve(
    Response.json(
      { build, contract_version: 5, live_members: 0, ok: true, rooms: 0, uptime_s: 1, version: '0.1.0' },
      { status: 200 },
    ),
  );
const healthy = () =>
  Promise.resolve(
    Response.json(
      { build: CURRENT, contract_version: 5, live_members: 2, ok: true, rooms: 1, uptime_s: 3725, version: '0.1.0' },
      { status: 200 },
    ),
  );
const refused = () => Promise.reject(new TypeError('fetch failed'));

describe('runStatus', () => {
  it('says a daemon running older code than the install should restart', async () => {
    const result = await runStatus({
      app: undefined,
      fetch: stamped(STALE),
      installed: INSTALLED,
      nodeExists: () => true,
      plist: undefined,
      url: URL_BASE,
    });

    expect(result.report.split('\n').at(-1)).toBe(
      'warning: the daemon runs older code than the installed messhall. run messhall start',
    );
  });

  it('says a built app older than the daemon should be rebuilt', async () => {
    const result = await runStatus({
      app: { build: STALE, contract: 5 },
      fetch: stamped(CURRENT),
      installed: INSTALLED,
      nodeExists: () => true,
      plist: undefined,
      url: URL_BASE,
    });

    expect(result.report.split('\n').at(-1)).toBe('warning: the built app is older than the daemon. run make app');
  });

  it('reports an up daemon with its version, uptime, rooms and live members', async () => {
    const result = await runStatus({
      app: undefined,
      fetch: healthy,
      installed: INSTALLED,
      nodeExists: () => true,
      plist: undefined,
      url: URL_BASE,
    });

    expect(result).toStrictEqual({
      code: 0,
      report: [
        'messhall is up on http://127.0.0.1:7797',
        'version  0.1.0',
        'uptime   1h 2m 5s',
        'rooms    1',
        'live     2 members',
      ].join('\n'),
    });
  });

  it('reports a down daemon and exits 1', async () => {
    const result = await runStatus({
      app: undefined,
      fetch: refused,
      installed: INSTALLED,
      nodeExists: () => true,
      plist: undefined,
      url: URL_BASE,
    });

    expect(result).toStrictEqual({
      code: 1,
      report: 'messhall is down, nothing answers on http://127.0.0.1:7797. run messhall start',
    });
  });

  it('says when something other than messhall holds the port', async () => {
    const other = () => Promise.resolve(new Response('<html></html>', { status: 200 }));

    const result = await runStatus({
      app: undefined,
      fetch: other,
      installed: INSTALLED,
      nodeExists: () => true,
      plist: undefined,
      url: URL_BASE,
    });

    expect(result.code).toBe(1);
    expect(result.report).toBe('something answers on http://127.0.0.1:7797, but it is not messhall');
  });

  it('warns when the LaunchAgent node path is gone', async () => {
    const result = await runStatus({
      app: undefined,
      fetch: healthy,
      installed: INSTALLED,
      nodeExists: () => false,
      plist: FIXTURE,
      url: URL_BASE,
    });

    expect(result.report.split('\n').at(-1)).toBe(
      'warning: the LaunchAgent runs /Users/someone/.nvm/versions/node/v22.21.0/bin/node, which is gone. run messhall install again',
    );
  });

  it('stays quiet when the LaunchAgent node path is there', async () => {
    const result = await runStatus({
      app: undefined,
      fetch: healthy,
      installed: INSTALLED,
      nodeExists: () => true,
      plist: FIXTURE,
      url: URL_BASE,
    });

    expect(result.report).not.toContain('warning');
  });
});
