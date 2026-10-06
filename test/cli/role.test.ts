import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runRole } from '../../src/cli/role.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
  feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
});

afterEach(async () => {
  await feed.close();
});

const role = (overrides: Partial<Parameters<typeof runRole>[0]> = {}) =>
  runRole({
    dataDir: feed.scratch.dataDir,
    fetch,
    member: 'api',
    role: 'reviewer',
    room: 'demo',
    url: feed.url,
    ...overrides,
  });

const roleOf = () => feed.scratch.store.roleOf({ name: 'api', room: 'demo' });

describe('runRole', () => {
  it('sets the role as the human and says so in one line', async () => {
    const result = await role();

    expect(result).toStrictEqual({ code: 0, output: 'api is now reviewer in #demo' });
    expect(roleOf()).toStrictEqual({ by: 'human', instructions: null, role: 'reviewer' });
  });

  it('takes instructions as text', async () => {
    await role({ instructions: 'review every pr' });

    expect(roleOf()?.instructions).toBe('review every pr');
  });

  it('reads instructions from a file when the value is a path', async () => {
    const file = path.join(feed.scratch.dataDir, 'reviewer.md');
    writeFileSync(file, 'review every pr\n');

    await role({ instructions: file });

    expect(roleOf()?.instructions).toBe('review every pr\n');
  });

  it('passes on the daemon refusal in one line', async () => {
    const result = await role({ member: 'web' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe('messhall refused the role: no member web in #demo');
  });

  it('says the daemon is down in one line', async () => {
    const result = await role({ url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toBe(
      'messhall is down, nothing answers on http://127.0.0.1:1. run messhall start',
    );
  });

  it('says so when there is no human key yet', async () => {
    rmSync(path.join(feed.scratch.dataDir, KEY_FILES.human));

    const result = await role();

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.output)).toMatch(/^no human key in .+, start the daemon once$/);
  });
});
