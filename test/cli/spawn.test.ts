import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runFlock, runFlockStop, runSpawn } from '../../src/cli/spawn.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;
let cwd: string;

beforeEach(async () => {
  feed = await feedServer();
  feed.scratch.store.createRoom({ created_by: 'human', name: 'demo' });
  cwd = mkdtempSync(path.join(tmpdir(), 'messhall-spawn-cli-'));
});

afterEach(async () => {
  await feed.close();
});

const store = () => feed.scratch.store;
const plain = (result: { output: string }) => stripVTControlCharacters(result.output);
const shared = () => ({ dataDir: feed.scratch.dataDir, fetch, url: feed.url });

const spawn = (overrides: Partial<Parameters<typeof runSpawn>[0]> = {}) =>
  runSpawn({ ...shared(), cwd, name: 'api', role: 'worker', room: 'demo', ...overrides });

describe('runSpawn', () => {
  it('seats the agent with its role and names the session to attach to', async () => {
    feed.seatOnStart();

    const result = await spawn();

    expect(result.code).toBe(0);
    expect(plain(result)).toContain('api is seated in #demo as worker');
    expect(plain(result)).toContain('tmux attach -t messhall-demo-api');
  });

  it('reads instructions from a file when the value is a path', async () => {
    feed.seatOnStart();
    const file = path.join(cwd, 'worker.md');
    writeFileSync(file, 'build the api\n');

    await spawn({ instructions: file });

    expect(store().roleOf({ name: 'api', room: 'demo' })?.instructions).toBe('build the api\n');
  });

  it('prints the refusal from the daemon', async () => {
    const result = await spawn({ cwd: path.join(cwd, 'missing') });

    expect(result.code).toBe(1);
    expect(plain(result)).toContain('not a folder');
  });

  it('refuses with one line when there is no human key', async () => {
    rmSync(path.join(feed.scratch.dataDir, KEY_FILES.human));

    const result = await spawn();

    expect(result.code).toBe(1);
    expect(plain(result)).toContain('no human key');
  });

  it('says the daemon is down when nothing answers', async () => {
    const result = await spawn({ url: 'http://127.0.0.1:1' });

    expect(result.code).toBe(1);
    expect(plain(result)).toContain('messhall is down');
  });
});

describe('runFlock', () => {
  it('lists each spawned seat with its role, process and session', async () => {
    store().invite({ by: 'human', launch: { agent: 'claude', cwd }, name: 'api', role: 'worker', room: 'demo' });

    const result = await runFlock({ ...shared(), room: 'demo' });

    expect(result.code).toBe(0);
    expect(plain(result)).toMatch(/#demo\s+api\s+worker\s+invited\s+claude\s+gone\s+messhall-demo-api/);
  });

  it('says so when nothing was spawned', async () => {
    const result = await runFlock(shared());

    expect(plain(result)).toBe('no spawned seats');
  });
});

describe('runFlockStop', () => {
  it('kills the session and removes the seat', async () => {
    store().invite({ by: 'human', launch: { agent: 'claude', cwd }, name: 'api', role: 'worker', room: 'demo' });

    const result = await runFlockStop({ ...shared(), name: 'api' });

    expect(result.code).toBe(0);
    expect(plain(result)).toBe('stopped api in #demo, its seat is removed');
    expect(feed.tmux).toHaveBeenCalledWith(['kill-session', '-t', 'messhall-demo-api']);
    expect(
      store()
        .listMembers('demo')
        .map(member => member.name),
    ).toStrictEqual(['human']);
  });

  it('asks for the room when the name is spawned in two rooms', async () => {
    store().createRoom({ created_by: 'human', name: 'ops' });
    ['demo', 'ops'].forEach(room =>
      store().invite({ by: 'human', launch: { agent: 'claude', cwd }, name: 'api', role: 'worker', room }),
    );

    const result = await runFlockStop({ ...shared(), name: 'api' });

    expect(result.code).toBe(1);
    expect(plain(result)).toContain('pass --room');
  });

  it('refuses a name that was never spawned', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    const result = await runFlockStop({ ...shared(), name: 'api' });

    expect(result.code).toBe(1);
    expect(plain(result)).toContain('no spawned seat api');
  });
});
