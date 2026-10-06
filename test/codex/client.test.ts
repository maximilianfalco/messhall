import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodexClient, type CodexClient } from '../../src/codex/client.js';
import { CODEX_RECONNECT_MIN_MS, CODEX_REQUEST_TIMEOUT_MS } from '../../src/config.js';

import { fakeCodex, type FakeCodex, fakeTimers } from './fakeCodex.js';

const TID = '01a10e95-f79c-7573-8c27-8f50dbc18a59';
const IDLE = { thread: { id: TID, status: { type: 'idle' } } };

let codex: FakeCodex;
let client: CodexClient;
let timers: ReturnType<typeof fakeTimers>;

beforeEach(async () => {
  codex = await fakeCodex({
    'thread/loaded/list': () => ({ hold: true }),
    'thread/read': params =>
      (params as { threadId: string }).threadId === TID ? { result: IDLE } : { error: 'thread not loaded' },
  });
  timers = fakeTimers();
  client = createCodexClient({ setTimer: timers.setTimer, socketPath: codex.socketPath });
});

afterEach(async () => {
  client.close();
  await codex.cleanup();
});

describe('createCodexClient', () => {
  it('sends initialize and initialized before the first request', async () => {
    await client.request('thread/read', { threadId: TID });

    expect(codex.frames.slice(0, 3)).toStrictEqual([
      {
        id: 1,
        method: 'initialize',
        params: {
          capabilities: { experimentalApi: true, requestAttestation: false },
          clientInfo: { name: 'messhall', title: null, version: '0.1.0' },
        },
      },
      { method: 'initialized', params: {} },
      { id: 2, method: 'thread/read', params: { threadId: TID } },
    ]);
  });

  it('matches replies to requests by id when they come back out of order', async () => {
    const listed = client.request('thread/loaded/list', {});
    await vi.waitFor(() => expect(codex.held).toHaveLength(1));

    const read = await client.request('thread/read', { threadId: TID });
    codex.held[0]!.reply({ data: [TID], nextCursor: null });

    expect(read).toStrictEqual({ ok: true, result: IDLE });
    await expect(listed).resolves.toStrictEqual({ ok: true, result: { data: [TID], nextCursor: null } });
  });

  it('turns an error reply into a failed result', async () => {
    await expect(client.request('thread/read', { threadId: 'gone' })).resolves.toStrictEqual({
      error: 'thread not loaded',
      ok: false,
    });
  });

  it('fails a request with no reply after the timeout', async () => {
    const listed = client.request('thread/loaded/list', {});
    await vi.waitFor(() => expect(codex.held).toHaveLength(1));

    expect(timers.delays()).toStrictEqual([CODEX_REQUEST_TIMEOUT_MS]);
    timers.fireAll();

    await expect(listed).resolves.toStrictEqual({ error: 'codex did not answer thread/loaded/list', ok: false });
  });

  it('fails without throwing when nothing listens on the socket', async () => {
    await codex.stop();

    const read = await client.request('thread/read', { threadId: TID });

    expect(read.ok).toBe(false);
  });

  it('fails the open request when the socket closes', async () => {
    const listed = client.request('thread/loaded/list', {});
    await vi.waitFor(() => expect(codex.held).toHaveLength(1));

    codex.dropAll();

    await expect(listed).resolves.toStrictEqual({ error: 'codex control socket closed', ok: false });
  });

  it('reconnects after a close with a backoff that doubles while the socket stays down', async () => {
    await client.request('thread/read', { threadId: TID });
    await codex.stop();

    await vi.waitFor(() => expect(timers.delays()).toStrictEqual([CODEX_RECONNECT_MIN_MS]));
    timers.fireAll();
    await vi.waitFor(() => expect(timers.delays()).toStrictEqual([CODEX_RECONNECT_MIN_MS * 2]));
    timers.fireAll();
    await vi.waitFor(() => expect(timers.delays()).toStrictEqual([CODEX_RECONNECT_MIN_MS * 4]));

    await codex.serve();
    timers.fireAll();

    await vi.waitFor(() => expect(codex.connections).toBe(2));
    await vi.waitFor(() => expect(codex.frames.filter(frame => frame.method === 'initialize')).toHaveLength(2));
    expect(timers.delays()).toStrictEqual([]);
    await expect(client.request('thread/read', { threadId: TID })).resolves.toStrictEqual({ ok: true, result: IDLE });
  });

  it('stops reconnecting once closed', async () => {
    await client.request('thread/read', { threadId: TID });

    client.close();
    codex.dropAll();

    await vi.waitFor(() => expect(codex.connections).toBe(1));
    expect(timers.delays()).toStrictEqual([]);
  });
});
