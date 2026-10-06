import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { joinPostLeave, lostSession } from '../../src/mcp/oneshot.js';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const memberRow = (name: string) =>
  harness.db.prepare('SELECT cursor, left_at, presence FROM members WHERE name = ?').get(name);

const systemLines = () => {
  const listed = harness.store.listMessages({ limit: 50, room: 'checkout' });
  return listed.ok ? listed.messages.filter(message => message.kind === 'system').map(message => message.text) : [];
};

describe('joinPostLeave', () => {
  it('joins, posts and ends with leave, so the member reads left and not gone', async () => {
    const { client } = await harness.agent();

    const result = await joinPostLeave({ as: 'api', client, room: 'checkout', text: 'hello' });

    expect(result.replies.map(reply => reply.name)).toStrictEqual(['join', 'post', 'leave']);
    expect(result.replies.every(reply => !reply.isError)).toBe(true);
    expect(memberRow('api')?.left_at).not.toBeNull();
    expect(systemLines()).toStrictEqual(['api joined', 'api left']);
  });

  it('returns the posted message id', async () => {
    const { client } = await harness.agent();

    const result = await joinPostLeave({ as: 'api', client, room: 'checkout', text: 'hello' });

    const listed = harness.store.listMessages({ limit: 50, room: 'checkout' });
    const posted = listed.ok ? listed.messages.find(message => message.text === 'hello') : undefined;
    expect(result.id).toBe(posted?.id);
  });

  it('passes done through to the post', async () => {
    const { client } = await harness.agent();
    await harness.joined('checkout', 'web');

    await joinPostLeave({ as: 'api', client, done: true, room: 'checkout', text: 'my part is in' });

    const listed = harness.store.listMessages({ limit: 50, room: 'checkout' });
    expect(listed.ok && listed.messages.find(message => message.text === 'my part is in')?.kind).toBe('done');
  });

  it('keeps the cursor the member already had', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await web.call('post', { room: 'checkout', text: 'first' });
    await api.call('read_since', { room: 'checkout' });
    await api.call('leave', { room: 'checkout' });
    const before = memberRow('api')?.cursor;
    const { client } = await harness.agent();

    await joinPostLeave({ as: 'api', client, room: 'checkout', text: 'back for one line' });

    expect(memberRow('api')?.cursor).toBe(before);
    expect(memberRow('api')?.left_at).not.toBeNull();
  });

  it('still leaves when the post is refused, and gives no id', async () => {
    const { client } = await harness.agent();

    const result = await joinPostLeave({ as: 'api', client, room: 'checkout', text: 'x'.repeat(4001) });

    expect(result.replies.map(reply => [reply.name, reply.isError])).toStrictEqual([
      ['join', false],
      ['post', true],
      ['leave', false],
    ]);
    expect(result.id).toBeUndefined();
    expect(memberRow('api')?.left_at).not.toBeNull();
  });

  it('stops after a refused join', async () => {
    await harness.joined('checkout', 'api');
    const { client } = await harness.agent();

    const result = await joinPostLeave({ as: 'api', client, room: 'checkout', text: 'hello' });

    expect(result.replies.map(reply => [reply.name, reply.isError])).toStrictEqual([['join', true]]);
  });
});

const httpError = (status: number) =>
  new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, `Error POSTing to endpoint: ${status}`, { status });
const refused = () =>
  new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });

describe('lostSession', () => {
  it.each([
    ['a 404 session not found', httpError(404)],
    ['a 5xx', httpError(503)],
    ['a refused connection', refused()],
    ['a failed stream reconnect', new Error('Failed to reconnect SSE stream: fetch failed', { cause: refused() })],
    ['used up stream retries', new Error('Maximum reconnection attempts (2) exceeded.')],
  ])('is true for %s', (_case, error) => {
    expect(lostSession(error)).toBe(true);
  });

  it.each([
    ['a 400', httpError(400)],
    ['a 401', httpError(401)],
    ['a plain error', new Error('boom')],
    ['a string', 'nope'],
  ])('is false for %s', (_case, error) => {
    expect(lostSession(error)).toBe(false);
  });
});
