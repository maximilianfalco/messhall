import type { Progress } from '@modelcontextprotocol/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitLimitFor } from '../../src/mcp/tools/wait.js';

import { mcpHarness, type McpHarness } from './harness.js';

const LONG = { timeout: 600_000 };

let harness: McpHarness;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  harness = mcpHarness();
});

afterEach(async () => {
  vi.useRealTimers();
  await harness.cleanup();
});

const memberOf = (name: string) => harness.store.listMembers('checkout').find(member => member.name === name)!;

function pending<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T } = { done: false };
  promise.then(value => {
    state.done = true;
    state.value = value;
  });
  return state;
}

async function trio() {
  const api = await harness.joined('checkout', 'api');
  const web = await harness.joined('checkout', 'web');
  const ios = await harness.joined('checkout', 'ios');
  await api.call('read_since', { room: 'checkout' });
  return { api, ios, web };
}

describe('wait', () => {
  it('stays asleep for a line from a paused partner and wakes for the human', async () => {
    const api = await harness.joined('checkout', 'api');
    await harness.joined('checkout', 'web');
    Array.from({ length: 12 }, (_, index) =>
      harness.store.postMessage({ from: index % 2 ? 'web' : 'api', room: 'checkout', text: `line ${index}` }),
    );
    await api.call('read_since', { room: 'checkout' });

    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 30 }, LONG));
    harness.store.postMessage({ from: 'web', room: 'checkout', text: '@api one more' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(waiting.done).toBe(false);

    harness.store.postMessage({ from: 'human', room: 'checkout', text: 'wrap it up' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(waiting.value?.text).toContain('human posted');
  });

  it('times out with the call again text and never moves the cursor', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await web.call('post', { room: 'checkout', text: 'not for you' });
    harness.store.leaveRoom({ as: 'web', room: 'checkout' });
    const cursor = memberOf('api').cursor;

    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 5 }, LONG));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(waiting.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(waiting.value).toStrictEqual({ isError: false, text: 'nothing yet, call wait again.' });
    expect(memberOf('api').cursor).toBe(cursor);
  });

  it('waits 100 seconds by default', async () => {
    const api = await harness.joined('checkout', 'api');

    const waiting = pending(api.call('wait', { room: 'checkout' }, LONG));
    await vi.advanceTimersByTimeAsync(99_999);
    expect(waiting.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(waiting.done).toBe(true);
  });

  it.each([
    ['omp', 25],
    ['oh-my-pi', 25],
    ['Cline', 50],
    ['prime-agent', 50],
    ['Roo Code', 50],
    ['Kilo Code', 50],
  ])('caps wait for %s at %i seconds', (client, seconds) => {
    expect(waitLimitFor(client)).toStrictEqual({ defaultS: seconds, maxS: seconds });
  });

  it.each(['claude-code', 'codex-mcp-client', 'opencode', undefined])('keeps 100 s and 270 s for %s', client => {
    expect(waitLimitFor(client)).toStrictEqual({ defaultS: 100, maxS: 270 });
  });

  it('waits 25 seconds by default for a client with a 30 second tool timeout', async () => {
    const api = await harness.agent({ name: 'omp' });
    await api.call('join', { as: 'api', room: 'checkout' });

    const waiting = pending(api.call('wait', { room: 'checkout' }, LONG));
    await vi.advanceTimersByTimeAsync(24_999);
    expect(waiting.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(waiting.value?.text).toBe('nothing yet, call wait again.');
  });

  it('clamps an explicit timeout_s to the safe max for a short timeout client', async () => {
    const api = await harness.agent({ name: 'Cline' });
    await api.call('join', { as: 'api', room: 'checkout' });

    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 200 }, LONG));
    await vi.advanceTimersByTimeAsync(50_000);

    expect(waiting.value?.text).toBe('nothing yet, call wait again.');
  });

  it('lets an explicit timeout_s under the safe max win', async () => {
    const api = await harness.agent({ name: 'Cline' });
    await api.call('join', { as: 'api', room: 'checkout' });

    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 10 }, LONG));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(waiting.done).toBe(true);
  });

  it('never waits past 270 seconds', async () => {
    const api = await harness.joined('checkout', 'api');

    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 1000 }, LONG));
    await vi.advanceTimersByTimeAsync(270_000);

    expect(waiting.value?.text).toBe('nothing yet, call wait again.');
  });

  it('resolves for a mention and not for an unrelated message in a three member room', async () => {
    const { api, ios, web } = await trio();

    const waiting = pending(api.call('wait', { room: 'checkout' }, LONG));
    await ios.call('post', { room: 'checkout', text: 'the build is green' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(waiting.done).toBe(false);
    await web.call('post', { room: 'checkout', text: '@api total is cents now' });
    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.value).toStrictEqual({
      isError: false,
      text: '2 new since your last read in #checkout (web mentioned you). Call read_since.',
    });
  });

  it('returns at once when something that concerns the caller is already unseen', async () => {
    const { api } = await trio();
    harness.store.postMessage({ from: 'human', room: 'checkout', text: 'status?' });

    const result = await api.call('wait', { room: 'checkout' }, LONG);

    expect(result.text).toBe('1 new since your last read in #checkout (human posted). Call read_since.');
  });

  it('calls posts from before this session joined the backlog', async () => {
    const first = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await first.call('leave', { room: 'checkout' });
    await web.call('post', { room: 'checkout', text: 'the schema moved' });
    await web.call('post', { room: 'checkout', text: 'and the docs' });
    const api = await harness.joined('checkout', 'api');

    const result = await api.call('wait', { room: 'checkout' }, LONG);

    expect(result.text).toBe(
      '2 unread from before you joined this session (backlog) in #checkout (web posted). Call read_since.',
    );
  });

  it('counts new and backlog apart when both are unread', async () => {
    const first = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await harness.joined('checkout', 'ios');
    await first.call('leave', { room: 'checkout' });
    await web.call('post', { room: 'checkout', text: 'old news' });
    const api = await harness.joined('checkout', 'api');

    const waiting = pending(api.call('wait', { room: 'checkout' }, LONG));
    await web.call('post', { room: 'checkout', text: '@api fresh news' });
    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.value?.text).toBe(
      '1 new since your last read and 1 unread from before you joined this session (backlog) in #checkout (web mentioned you). Call read_since.',
    );
  });

  it('waits on every joined room when room is left out', async () => {
    const api = await harness.joined('checkout', 'api');
    await api.call('join', { as: 'api', room: 'billing' });
    const other = await harness.agent();
    await other.call('join', { as: 'web', room: 'billing' });
    await api.call('read_since', { room: 'billing' });

    const waiting = pending(api.call('wait', {}, LONG));
    await other.call('post', { room: 'billing', text: 'invoice ids are uuids' });
    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.value?.text).toBe('1 new since your last read in #billing (web posted). Call read_since.');
  });

  it('marks the member waiting while blocked and active after', async () => {
    const api = await harness.joined('checkout', 'api');

    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 10 }, LONG));
    await vi.advanceTimersByTimeAsync(0);
    expect(memberOf('api').presence).toBe('waiting');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(waiting.done).toBe(true);
    expect(memberOf('api').presence).toBe('active');
  });

  it('leaves a member gone when its session ended during the wait', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await api.call('read_since', { room: 'checkout' });
    const waiting = pending(api.call('wait', { room: 'checkout', timeout_s: 10 }, LONG));
    await vi.advanceTimersByTimeAsync(0);

    api.session.unbind('checkout');
    harness.store.touch({ as: 'api', room: 'checkout', state: 'gone' });
    await web.call('post', { room: 'checkout', text: '@api still there?' });
    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.done).toBe(true);
    expect(memberOf('api').presence).toBe('gone');
  });

  it('sends progress every 30 seconds when the call carries a progress token', async () => {
    const api = await harness.joined('checkout', 'api');
    const onprogress = vi.fn<(progress: Progress) => void>();

    const waiting = pending(api.call('wait', { room: 'checkout' }, { ...LONG, onprogress }));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(onprogress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61_000);

    expect(onprogress.mock.calls.map(([progress]) => progress)).toStrictEqual([
      { message: 'waiting on #checkout', progress: 30, total: 100 },
      { message: 'waiting on #checkout', progress: 60, total: 100 },
      { message: 'waiting on #checkout', progress: 90, total: 100 },
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(waiting.done).toBe(true);
  });

  it('stops when the client cancels the call', async () => {
    const api = await harness.joined('checkout', 'api');
    const controller = new AbortController();

    const call = api.call('wait', { room: 'checkout' }, { ...LONG, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(call).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(0);

    expect(memberOf('api').presence).toBe('active');
  });

  it('says call join first for a room the session has not joined', async () => {
    const agent = await harness.agent();

    const result = await agent.call('wait', { room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'you are not in #checkout. call join first.' });
  });

  it('says call join first when the session joined nothing', async () => {
    const agent = await harness.agent();

    const result = await agent.call('wait', {});

    expect(result).toStrictEqual({ isError: true, text: 'you have not joined a room. call join first.' });
  });
});
