import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodexClient } from '../../../src/codex/client.js';
import { createCodexRinger } from '../../../src/doorbell/ringers/codex.js';
import { createSession } from '../../../src/mcp/session.js';
import { fakeCodex, fakeCodexRpc, fakeTimers } from '../../codex/fakeCodex.js';
import { LIVE_THREAD, mcpHarness, type McpHarness } from '../../mcp/harness.js';

const RING = {
  member: { name: 'web', rooms: ['checkout'] },
  meta: { count: '1', room: 'checkout' },
  text: 'messhall: 1 new in #checkout, api mentioned you. Call read_since.',
};

const now = () => new Date('2026-01-01T10:00:00.000Z');

function codexSession({ id, threadId }: { id: string; threadId?: string }) {
  const session = createSession({ id, now });
  session.bind({ kind: 'codex', name: 'web', room: 'checkout', threadId });
  return session;
}

describe('createCodexRinger', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends thread/queue/add with the ring line to the thread over the control socket', async () => {
    const codex = await fakeCodex({ 'thread/queue/add': () => ({ result: { queuedSubmission: {} } }) });
    const client = createCodexClient({ setTimer: fakeTimers().setTimer, socketPath: codex.socketPath });
    const session = codexSession({ id: 's1', threadId: LIVE_THREAD });
    const ringer = createCodexRinger({ codex: client, sessionsFor: () => [{ session }] });

    const reached = await ringer.ring(RING);

    client.close();
    await codex.cleanup();
    expect(reached).toBe(1);
    expect(codex.frames.filter(frame => frame.method === 'thread/queue/add')).toStrictEqual([
      {
        id: 2,
        method: 'thread/queue/add',
        params: {
          clientUserMessageId: expect.any(String),
          input: [
            {
              text: 'messhall: 1 new in #checkout, api mentioned you. Call read_since.',
              text_elements: [],
              type: 'text',
            },
          ],
          threadId: LIVE_THREAD,
        },
      },
    ]);
  });

  it('rings a thread once across rooms and skips sessions with no thread or another kind', async () => {
    const codex = fakeCodexRpc({ threads: { [LIVE_THREAD]: 'idle' } });
    const rung = codexSession({ id: 's1', threadId: LIVE_THREAD });
    const noThread = codexSession({ id: 's2' });
    const claude = createSession({ id: 's3', now });
    claude.bind({ kind: 'claude', name: 'web', room: 'checkout', threadId: LIVE_THREAD });
    const ringer = createCodexRinger({
      codex,
      sessionsFor: () => [{ session: rung }, { session: noThread }, { session: claude }],
    });

    const reached = await ringer.ring({ ...RING, member: { name: 'web', rooms: ['checkout', 'auth'] } });

    expect(reached).toBe(1);
    expect(codex.calls.map(call => call.method)).toStrictEqual(['thread/queue/add']);
  });

  it('drops the thread after a failed add and logs it once', async () => {
    const codex = await fakeCodex();
    const client = createCodexClient({ setTimer: fakeTimers().setTimer, socketPath: codex.socketPath });
    await codex.stop();
    const session = codexSession({ id: 's1', threadId: LIVE_THREAD });
    const ringer = createCodexRinger({ codex: client, sessionsFor: () => [{ session }] });

    const first = await ringer.ring(RING);
    const second = await ringer.ring(RING);

    client.close();
    await codex.cleanup();
    expect([first, second]).toStrictEqual([0, 0]);
    expect(session.threadId).toBeUndefined();
    const logged = vi
      .mocked(process.stderr.write)
      .mock.calls.filter(([line]) => String(line).includes('codex doorbell'));
    expect(logged).toHaveLength(1);
  });
});

describe('a codex member after a failed ring', () => {
  let harness: McpHarness;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    harness = mcpHarness();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await harness.cleanup();
  });

  it('shows no doorbell and still wakes from wait', async () => {
    const web = await harness.agent({ name: 'codex' });
    await web.call('join', { as: 'web', kind: 'codex', room: 'checkout', thread_id: LIVE_THREAD });
    const api = await harness.joined('checkout', 'api');
    harness.codex.fail('thread/queue/add');
    const ringer = createCodexRinger({ codex: harness.codex, sessionsFor: harness.sessions.sessionsFor });

    await expect(ringer.ring(RING)).resolves.toBe(0);
    const listed = await api.call('list_members', { room: 'checkout' });
    const waiting = web.call('wait', { room: 'checkout' }, { timeout: 600_000 });
    await vi.advanceTimersByTimeAsync(0);
    await api.call('post', { room: 'checkout', text: '@web are you there?' });

    expect(listed.text).toContain('- web (codex 0.1.0 (no doorbell), active)');
    await expect(waiting).resolves.toStrictEqual({
      isError: false,
      text: '1 new since your last read in #checkout (api mentioned you). Call read_since.',
    });
  });
});
