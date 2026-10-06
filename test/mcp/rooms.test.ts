import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LIVE_THREAD, mcpHarness, type McpHarness } from './harness.js';

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
      '- api (messhall-in-memory 0.1.0, active), last seen 2026-01-01T10:00:00.000Z',
      '- human (human, idle), last seen 2026-01-01T10:00:00.000Z',
    ]);
  });

  it('marks a codex member without a working thread as having no doorbell', async () => {
    const rung = await harness.agent({ name: 'codex' });
    await rung.call('join', { as: 'api', kind: 'codex', room: 'checkout', thread_id: LIVE_THREAD });
    const unrung = await harness.agent({ name: 'codex' });
    await unrung.call('join', { as: 'web', kind: 'codex', room: 'checkout' });

    const result = await unrung.call('list_members', { room: 'checkout' });

    expect(result.text).toContain('- api (codex 0.1.0, active), last seen');
    expect(result.text).toContain('- web (codex 0.1.0 (no doorbell), active, you), last seen');
  });

  it('shows the client label and version each agent sent at initialize', async () => {
    const web = await harness.agent({ name: 'opencode', version: '1.18.34' });
    await web.call('join', { as: 'web', room: 'checkout' });

    const result = await web.call('list_members', { room: 'checkout' });

    expect(result.text).toContain('- web (opencode 1.18.34, active, you), last seen');
  });

  it('shows the first word of an unknown client', async () => {
    const web = await harness.agent({ name: 'Cursor Agent', version: '2.0' });
    await web.call('join', { as: 'web', room: 'checkout' });

    const result = await web.call('list_members', { room: 'checkout' });

    expect(result.text).toContain('- web (Cursor 2.0, active, you), last seen');
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
  it('lists every room with state, members, posts and last activity', async () => {
    const api = await harness.joined('checkout', 'api');
    await api.call('post', { room: 'checkout', text: 'hello' });
    harness.clock.advance(60_000);
    await harness.joined('billing', 'web');
    const agent = await harness.agent();

    const result = await agent.call('list_rooms');

    expect(result.text.split('\n')).toStrictEqual([
      '2 rooms:',
      '#billing open, made by web, topic none, 0 posts, last activity 2026-01-01T10:01:00.000Z',
      '  members: human (human, idle), web (messhall-in-memory 0.1.0, active)',
      '#checkout open, made by api, topic none, 1 posts, last activity 2026-01-01T10:00:00.000Z',
      '  members: api (messhall-in-memory 0.1.0, active), human (human, idle)',
    ]);
  });

  it('marks a standing room made by the human, and a closed room', async () => {
    harness.store.createRoom({ created_by: 'human', name: 'planning', topic: 'q4' });
    harness.store.closeRoom('planning');
    const agent = await harness.agent();

    const result = await agent.call('list_rooms');

    expect(result.text.split('\n')).toStrictEqual([
      '1 rooms:',
      '#planning closed, standing (made by human), topic q4, 0 posts, last activity 2026-01-01T10:00:00.000Z',
      '  members: human (human, idle)',
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
