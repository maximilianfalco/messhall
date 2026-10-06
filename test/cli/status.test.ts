import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runStatus } from '../../src/cli/status.js';

const FIXTURE = readFileSync(new URL('fixtures/dev.messhall.daemon.plist', import.meta.url), 'utf8');
const URL_BASE = 'http://127.0.0.1:7797';

const healthy = () =>
  Promise.resolve(
    Response.json({ live_members: 2, ok: true, rooms: 1, uptime_s: 3725, version: '0.1.0' }, { status: 200 }),
  );
const refused = () => Promise.reject(new TypeError('fetch failed'));

describe('runStatus', () => {
  it('reports an up daemon with its version, uptime, rooms and live members', async () => {
    const result = await runStatus({ fetch: healthy, nodeExists: () => true, plist: undefined, url: URL_BASE });

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
    const result = await runStatus({ fetch: refused, nodeExists: () => true, plist: undefined, url: URL_BASE });

    expect(result).toStrictEqual({
      code: 1,
      report: 'messhall is down, nothing answers on http://127.0.0.1:7797. run messhall start',
    });
  });

  it('says when something other than messhall holds the port', async () => {
    const other = () => Promise.resolve(new Response('<html></html>', { status: 200 }));

    const result = await runStatus({ fetch: other, nodeExists: () => true, plist: undefined, url: URL_BASE });

    expect(result.code).toBe(1);
    expect(result.report).toBe('something answers on http://127.0.0.1:7797, but it is not messhall');
  });

  it('warns when the LaunchAgent node path is gone', async () => {
    const result = await runStatus({ fetch: healthy, nodeExists: () => false, plist: FIXTURE, url: URL_BASE });

    expect(result.report.split('\n').at(-1)).toBe(
      'warning: the LaunchAgent runs /Users/someone/.nvm/versions/node/v22.21.0/bin/node, which is gone. run messhall install again',
    );
  });

  it('stays quiet when the LaunchAgent node path is there', async () => {
    const result = await runStatus({ fetch: healthy, nodeExists: () => true, plist: FIXTURE, url: URL_BASE });

    expect(result.report).not.toContain('warning');
  });
});
