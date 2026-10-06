import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('list_members', () => {
  it('lists members with kind, presence and last seen without a join', async () => {
    await harness.joined('checkout', 'api');
    const outsider = await harness.agent();

    const result = await outsider.call('list_members', { room: 'checkout' });

    expect(result.isError).toBe(false);
    expect(result.text.split('\n')).toStrictEqual([
      '#checkout, 2 members:',
      '- api (other, active), last seen 2026-01-01T10:00:00.000Z',
      '- human (human, idle), last seen 2026-01-01T10:00:00.000Z',
    ]);
  });

  it('says when the room does not exist', async () => {
    const agent = await harness.agent();

    const result = await agent.call('list_members', { room: 'nowhere' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'no room #nowhere. call list_rooms to see the rooms, or join to make it.',
    });
  });
});

describe('list_rooms', () => {
  it('lists every room with state, members, posts against the cap and last activity', async () => {
    const api = await harness.joined('checkout', 'api');
    await api.call('post', { room: 'checkout', text: 'hello' });
    harness.clock.advance(60_000);
    await harness.joined('billing', 'web');
    const agent = await harness.agent();

    const result = await agent.call('list_rooms');

    expect(result.text.split('\n')).toStrictEqual([
      '2 rooms:',
      '#billing open, topic none, 0/200 posts, last activity 2026-01-01T10:01:00.000Z',
      '  members: human (human, idle), web (other, active)',
      '#checkout open, topic none, 1/200 posts, last activity 2026-01-01T10:00:00.000Z',
      '  members: api (other, active), human (human, idle)',
    ]);
  });

  it('says when there are no rooms yet', async () => {
    const agent = await harness.agent();

    const result = await agent.call('list_rooms');

    expect(result.text).toBe('no rooms yet. join one to make it.');
  });
});

describe('leave', () => {
  it('leaves with a note the room sees and unbinds the room', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await web.call('read_since', { room: 'checkout' });

    const result = await api.call('leave', { note: 'shipping the fix', room: 'checkout' });

    expect(result).toStrictEqual({ isError: false, text: 'left #checkout.' });
    expect(api.session.rooms.has('checkout')).toBe(false);
    expect((await web.call('read_since', { room: 'checkout' })).text).toContain('] api left: shipping the fix');
  });

  it('says call join first for a room the session has not joined', async () => {
    const agent = await harness.agent();

    const result = await agent.call('leave', { room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'you are not in #checkout. call join first.' });
  });
});
