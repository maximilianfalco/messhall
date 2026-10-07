import type { ChannelEntry } from '../../../src/doorbell/ringers/channel.js';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CHANNEL_METHOD, createChannelRinger } from '../../../src/doorbell/ringers/channel.js';
import { createMesshallServer } from '../../../src/mcp/server.js';
import { createSession, createSessionRegistry } from '../../../src/mcp/session.js';
import { connectInMemory } from '../../../src/mcp/testing.js';
import { fakeCodexRpc } from '../../codex/fakeCodex.js';
import { scratchStore } from '../../rooms/scratch.js';

const RING = {
  member: { name: 'web', rooms: ['checkout'] },
  meta: { count: '2', room: 'checkout' },
  text: 'messhall: 2 new in #checkout. Call read_since.',
};

function fakeEntry({ channel = true, fails = false, id }: { channel?: boolean; fails?: boolean; id: string }) {
  const notification = vi.fn<() => Promise<void>>(() =>
    fails ? Promise.reject(new Error('not connected')) : Promise.resolve(),
  );
  const entry: ChannelEntry = { server: { server: { notification } }, session: { channel, id } };
  return { entry, notification };
}

describe('createChannelRinger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the channel notification with the text and meta on every session of the member', async () => {
    const one = fakeEntry({ id: 's1' });
    const two = fakeEntry({ id: 's2' });
    const ringer = createChannelRinger({ sessionsFor: () => [one.entry, two.entry] });
    await expect(ringer.ring(RING)).resolves.toBe(2);
    const sent = {
      method: 'notifications/claude/channel',
      params: { content: '2 new in #checkout. Call read_since.', meta: RING.meta },
    };
    expect(one.notification).toHaveBeenCalledWith(sent);
    expect(two.notification).toHaveBeenCalledWith(sent);
  });

  it('rings a session once when it holds the member in two rooms', async () => {
    const one = fakeEntry({ id: 's1' });
    const ringer = createChannelRinger({ sessionsFor: () => [one.entry] });
    await ringer.ring({ ...RING, member: { name: 'web', rooms: ['checkout', 'auth'] } });
    expect(one.notification).toHaveBeenCalledTimes(1);
  });

  it('skips sessions that cannot take the channel', async () => {
    const plain = fakeEntry({ channel: false, id: 's1' });
    const ringer = createChannelRinger({ sessionsFor: () => [plain.entry] });
    await expect(ringer.ring(RING)).resolves.toBe(0);
    expect(plain.notification).not.toHaveBeenCalled();
  });

  it('serves the claude and other kinds', () => {
    expect(createChannelRinger({ sessionsFor: () => [] }).kinds).toStrictEqual(['claude', 'other']);
  });

  it('drops a dead session and still rings the live one', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dead = fakeEntry({ fails: true, id: 's1' });
    const live = fakeEntry({ id: 's2' });
    const ringer = createChannelRinger({ sessionsFor: () => [dead.entry, live.entry] });
    await expect(ringer.ring(RING)).resolves.toBe(1);
    expect(live.notification).toHaveBeenCalledTimes(1);
  });

  it('reaches a real other-kind channel client through the messhall server', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const scratch = scratchStore();
    const session = createSession({ id: 's1', now: scratch.clock.now });
    session.bind({ channel: true, kind: 'other', name: 'web', room: 'checkout' });
    const sessions = createSessionRegistry<{ session: typeof session }>();
    const server = createMesshallServer({
      codex: fakeCodexRpc(),
      now: scratch.clock.now,
      session,
      sessions,
      store: scratch.store,
    });
    const client = await connectInMemory(() => server);
    const received: unknown[] = [];
    client.setNotificationHandler(
      CHANNEL_METHOD,
      { params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) },
      params => {
        received.push(params);
      },
    );
    const ringer = createChannelRinger({ sessionsFor: () => [{ server, session }] });
    await ringer.ring(RING);
    await vi.waitFor(() =>
      expect(received).toStrictEqual([{ content: '2 new in #checkout. Call read_since.', meta: RING.meta }]),
    );
    expect(client.getServerCapabilities()?.experimental).toStrictEqual({
      'claude/channel': {},
      'claude/channel/permission': {},
    });
    await client.close();
    scratch.cleanup();
  });
});
