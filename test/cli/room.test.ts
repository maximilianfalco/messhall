import { rmSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runRoom } from '../../src/cli/room.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { feedServer } from '../feed/feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
});

afterEach(async () => {
  await feed.close();
});

const room = async (input: Parameters<typeof runRoom>[0]['input'], url = feed.url) => {
  const result = await runRoom({ dataDir: feed.scratch.dataDir, fetch, input, url });
  return { code: result.code, output: result.output.map(line => stripVTControlCharacters(line)) };
};
const rooms = () => feed.scratch.store.listRooms();

describe('runRoom', () => {
  it('makes a standing room with a topic', async () => {
    const result = await room({ action: 'new', name: 'planning', topic: 'q4' });

    expect(result).toStrictEqual({ code: 0, output: ['made #planning, standing until you close it'] });
    expect(rooms()[0]).toMatchObject({ created_by: 'human', standing: true, topic: 'q4' });
  });

  it('passes on the refusal for a name that exists', async () => {
    await room({ action: 'new', name: 'planning' });

    await expect(room({ action: 'new', name: 'planning' })).resolves.toStrictEqual({
      code: 1,
      output: ['messhall refused: room #planning already exists'],
    });
  });

  it('closes and reopens a room', async () => {
    await room({ action: 'new', name: 'planning' });

    await expect(room({ action: 'close', name: 'planning' })).resolves.toStrictEqual({
      code: 0,
      output: ['closed #planning'],
    });
    expect(rooms()[0]!.closed_at).not.toBeNull();
    await expect(room({ action: 'reopen', name: 'planning' })).resolves.toStrictEqual({
      code: 0,
      output: ['reopened #planning'],
    });
    expect(rooms()[0]!.closed_at).toBeNull();
  });

  it('mutes and unmutes a member', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    const mutedOf = () => feed.scratch.store.listMembers('checkout').find(member => member.name === 'api')?.muted;

    await expect(room({ action: 'mute', member: 'api', name: 'checkout' })).resolves.toStrictEqual({
      code: 0,
      output: ['muted api in #checkout, it can read but not post'],
    });
    expect(mutedOf()).toBe(true);
    await expect(room({ action: 'unmute', member: 'api', name: 'checkout' })).resolves.toStrictEqual({
      code: 0,
      output: ['unmuted api in #checkout'],
    });
    expect(mutedOf()).toBe(false);
  });

  it('passes on the refusal for a member who is not in the room', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });

    await expect(room({ action: 'mute', member: 'web', name: 'checkout' })).resolves.toStrictEqual({
      code: 1,
      output: ['messhall refused: no member web in #checkout'],
    });
  });

  it('lists every room, closed ones too, with the standing tag', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    await room({ action: 'new', name: 'planning', topic: 'q4' });
    await room({ action: 'close', name: 'planning' });

    await expect(room({ action: 'list' })).resolves.toStrictEqual({
      code: 0,
      output: ['#checkout  open, 2 members, 0 posts', '#planning  closed, standing, 1 members, 0 posts, q4'],
    });
  });

  it('kicks a left member out of the room', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });
    feed.scratch.store.leaveRoom({ as: 'api', room: 'checkout' });

    await expect(room({ action: 'kick', member: 'api', name: 'checkout' })).resolves.toStrictEqual({
      code: 0,
      output: ['removed api from #checkout'],
    });
    expect(feed.scratch.store.listMembers('checkout', { left: true }).map(member => member.name)).toStrictEqual([
      'human',
    ]);
  });

  it('kicks a member that is still here', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });

    await expect(room({ action: 'kick', member: 'api', name: 'checkout' })).resolves.toMatchObject({ code: 0 });
  });

  it('passes on the refusal to kick the human seat', async () => {
    feed.scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' });

    await expect(room({ action: 'kick', member: 'human', name: 'checkout' })).resolves.toStrictEqual({
      code: 1,
      output: ['messhall refused: the human seat cannot be removed'],
    });
  });

  it('says the daemon is down in one line', async () => {
    await expect(room({ action: 'list' }, 'http://127.0.0.1:1')).resolves.toStrictEqual({
      code: 1,
      output: ['messhall is down, nothing answers on http://127.0.0.1:1. run messhall start'],
    });
  });

  it('says so when there is no human key yet', async () => {
    rmSync(path.join(feed.scratch.dataDir, KEY_FILES.human));

    const result = await room({ action: 'close', name: 'planning' });

    expect(result.code).toBe(1);
    expect(result.output[0]).toMatch(/^no human key in .+, start the daemon once$/);
  });
});
