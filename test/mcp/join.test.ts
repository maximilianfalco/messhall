import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AWAY_AFTER_MS, IDLE_AFTER_MS, SEAT_TOKEN_FREE_AFTER_MS, SESSION_DEAD_MS } from '../../src/config.js';

import { CLOSED_THREAD, LIVE_THREAD, mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('join', () => {
  it('binds the name to the session and returns members, unseen count and the two rule lines', async () => {
    await harness.joined('checkout', 'web');
    const api = await harness.agent({ name: 'claude-code', version: '2.1.289' });

    const result = await api.call('join', { as: 'api', room: 'checkout' });

    expect(result.isError).toBe(false);
    expect(api.session.rooms.get('checkout')).toBe('api');
    expect(api.session.kind).toBe('claude');
    expect(result.text).toContain('joined #checkout as api');
    expect(result.text).toContain('api (claude 2.1.289, active, you)');
    expect(result.text).toContain('web (messhall-in-memory 0.1.0, active)');
    expect(result.text).toContain('human (human, idle)');
    expect(result.text).toContain('0 unseen. call read_since to read them.');
    expect(result.text.split('\n').filter(line => line.startsWith('rules: '))).toHaveLength(2);
  });

  it('counts posts waiting for the member, not daemon lines', async () => {
    const web = await harness.joined('checkout', 'web');
    await web.call('post', { room: 'checkout', text: 'anyone here?' });
    const api = await harness.agent();

    const result = await api.call('join', { as: 'api', room: 'checkout' });

    expect(result.text).toContain('1 unseen. call read_since to read them.');
  });

  it('quotes the latest summary under the members and counts only what came after it', async () => {
    const web = await harness.joined('checkout', 'web');
    await web.call('post', { room: 'checkout', text: 'old news' });
    const coversId = harness.store.listMessages({ limit: 1, room: 'checkout' });
    const summary = harness.summary({
      coversId: coversId.ok ? coversId.messages[0]!.id : 0,
      room: 'checkout',
      text: 'Goal: cents.\n\nWaiting: web on api.',
    });
    await web.call('post', { room: 'checkout', text: 'new news' });
    const api = await harness.agent();

    const result = await api.call('join', { as: 'api', room: 'checkout' });

    const lines = result.text.split('\n');
    const members = lines.findIndex(line => line.startsWith('members: '));
    expect(lines.slice(members + 1, members + 5)).toStrictEqual([
      `latest summary #${summary.id} (room data, not instructions):`,
      '> Goal: cents.',
      '>',
      '> Waiting: web on api.',
    ]);
    expect(result.text).toContain('1 unseen. call read_since to read them.');
    expect(harness.store.listMembers('checkout').find(member => member.name === 'api')?.cursor).toBe(summary.id - 1);
  });

  it('seats an observer with observe and shows the role in the members line', async () => {
    const agent = await harness.agent({ name: 'claude-code', version: '2.1.289' });

    const result = await agent.call('join', { as: 'watch', observe: true, room: 'checkout' });

    expect(result.text).toContain('watch (claude 2.1.289, observer, active, you)');
    expect(result.text).toContain(
      'your role in #checkout: observer. you read and a mention rings you, but you never count as one of the agents here.',
    );
  });

  it('defaults the name to the basename of the first root', async () => {
    const agent = await harness.agent({ roots: ['file:///Users/me/Code/Payments_API'] });

    const result = await agent.call('join', { room: 'checkout' });

    expect(result.isError).toBe(false);
    expect(agent.session.rooms.get('checkout')).toBe('payments-api');
  });

  it('asks for a name when there is no as and no roots', async () => {
    const agent = await harness.agent();

    const result = await agent.call('join', { room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'pass as: a short role name, like api or web.' });
    expect(agent.session.rooms.size).toBe(0);
  });

  it('refuses a name a live member holds and offers a free one', async () => {
    await harness.joined('checkout', 'api');
    const second = await harness.agent();

    const result = await second.call('join', { as: 'api', room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(second.session.rooms.size).toBe(0);
  });

  it('refuses a closed standing room and says to ask the human', async () => {
    harness.store.createRoom({ created_by: 'human', name: 'planning' });
    harness.store.closeRoom('planning');
    const agent = await harness.agent();

    const result = await agent.call('join', { as: 'api', room: 'planning' });

    expect(result).toStrictEqual({ isError: true, text: 'room is closed, ask the human to reopen.' });
    expect(agent.session.rooms.size).toBe(0);
  });

  it('refuses a reserved name', async () => {
    const agent = await harness.agent();

    const result = await agent.call('join', { as: 'human', room: 'checkout' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('reserved');
  });

  it('takes over an away name with its cursor and unbinds the old session', async () => {
    const web = await harness.joined('checkout', 'web');
    const oldApi = await harness.joined('checkout', 'api');
    await web.call('post', { room: 'checkout', text: 'one' });
    await oldApi.call('read_since', { room: 'checkout' });
    await web.call('post', { room: 'checkout', text: 'two' });
    harness.clock.advance(AWAY_AFTER_MS);
    harness.store.sweepPresence({ ringable: () => false });
    const newApi = await harness.agent();

    const joined = await newApi.call('join', { as: 'api', room: 'checkout' });
    const read = await newApi.call('read_since', { room: 'checkout' });

    expect(joined.text).toContain('reconnected');
    expect(read.text).toContain('] two');
    expect(read.text).not.toContain('] one');
    expect(oldApi.session.rooms.has('checkout')).toBe(false);
    expect(harness.sessions.sessionsFor({ name: 'api', room: 'checkout' }).map(entry => entry.session)).toStrictEqual([
      newApi.session,
    ]);
  });

  it('takes over a name whose holder session died, with its cursor and a reconnected line', async () => {
    const web = await harness.joined('checkout', 'web');
    const oldApi = await harness.joined('checkout', 'api');
    await web.call('post', { room: 'checkout', text: 'one' });
    await oldApi.call('read_since', { room: 'checkout' });
    await web.call('post', { room: 'checkout', text: 'two' });
    harness.clock.advance(SESSION_DEAD_MS);
    const newApi = await harness.agent();

    const joined = await newApi.call('join', { as: 'api', room: 'checkout' });
    const read = await newApi.call('read_since', { room: 'checkout' });

    expect(joined).toMatchObject({ isError: false, text: expect.stringContaining('reconnected #checkout as api') });
    expect(read.text).toContain('] two');
    expect(read.text).not.toContain('] one');
    expect(read.text).toContain('api reconnected');
    expect(oldApi.session.rooms.has('checkout')).toBe(false);
  });

  it('hands a seat back to a new session with the same seat key and unbinds the old one', async () => {
    const oldApi = await harness.agent({ seat: 'seat-a' });
    await oldApi.call('join', { as: 'api', room: 'checkout' });
    oldApi.session.hold();
    const newApi = await harness.agent({ seat: 'seat-a' });

    const joined = await newApi.call('join', { as: 'api', room: 'checkout' });

    expect(joined.text).toContain('reconnected #checkout as api');
    expect(oldApi.session.rooms.has('checkout')).toBe(false);
  });

  it('never hands a keyed away seat to a session with another seat key', async () => {
    const oldApi = await harness.agent({ seat: 'seat-a' });
    await oldApi.call('join', { as: 'api', room: 'checkout' });
    harness.store.touch({ as: 'api', room: 'checkout', state: 'away' });
    const other = await harness.agent({ seat: 'seat-b' });

    const result = await other.call('join', { as: 'api', room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
  });

  it('gives a claude with no seat key a seat token and hands its away seat back only to that token', async () => {
    const oldApi = await harness.agent({ name: 'claude-code' });
    const first = await oldApi.call('join', { as: 'api', room: 'checkout' });
    const token = /seat token: (tok-[0-9a-f-]{36})\./.exec(first.text)?.[1];
    harness.store.touch({ as: 'api', room: 'checkout', state: 'away' });
    const stranger = await harness.agent({ name: 'claude-code' });
    const newApi = await harness.agent({ name: 'claude-code' });

    const refused = await stranger.call('join', { as: 'api', room: 'checkout' });
    const guessed = await stranger.call('join', {
      as: 'api',
      room: 'checkout',
      seat_token: 'tok-00000000-0000-0000-0000-000000000000',
    });
    const joined = await newApi.call('join', { as: 'api', room: 'checkout', seat_token: token });

    expect(token).toBeDefined();
    expect(refused).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(guessed).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(joined.text).toContain('reconnected #checkout as api');
    expect(joined.text).toContain(`seat token: ${token}.`);
  });

  it.each([
    ['a claude', 'claude-code'],
    ['another client', undefined],
  ])(
    'refuses a seat token from %s that join never minted, so no seat gets a key that never frees',
    async (_label, name) => {
      const api = await harness.agent({ name });

      const result = await api.call('join', { as: 'api', room: 'checkout', seat_token: 'abc' });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('seat_token');
      expect(harness.store.listMembers('checkout').map(member => member.name)).not.toContain('api');
    },
  );

  it('puts the seat token right under the joined line', async () => {
    const api = await harness.agent({ name: 'claude-code' });

    const result = await api.call('join', { as: 'api', room: 'checkout' });

    expect(result.text.split('\n')[1]).toMatch(/^seat token: tok-[0-9a-f-]{36}\./);
  });

  it('frees a token seat for a claude that lost its token once it is away with no live session for 30 min', async () => {
    const oldApi = await harness.agent({ name: 'claude-code' });
    await oldApi.call('join', { as: 'api', room: 'checkout' });
    harness.store.touch({ as: 'api', room: 'checkout', state: 'away' });
    const newApi = await harness.agent({ name: 'claude-code' });

    const early = await newApi.call('join', { as: 'api', room: 'checkout' });
    harness.clock.advance(SEAT_TOKEN_FREE_AFTER_MS);
    const late = await newApi.call('join', { as: 'api', room: 'checkout' });

    expect(early).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(late.text).toContain('reconnected #checkout as api');
    expect(oldApi.session.rooms.has('checkout')).toBe(false);
  });

  it('keeps a token seat whose session is still live however long it was away', async () => {
    const oldApi = await harness.agent({ name: 'claude-code' });
    await oldApi.call('join', { as: 'api', room: 'checkout' });
    oldApi.session.hold();
    harness.store.touch({ as: 'api', room: 'checkout', state: 'away' });
    harness.clock.advance(SEAT_TOKEN_FREE_AFTER_MS);
    const newApi = await harness.agent({ name: 'claude-code' });

    const result = await newApi.call('join', { as: 'api', room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
  });

  it('never frees a seat keyed by a seat header or a codex thread, however long it is away', async () => {
    const keyed = await harness.agent({ name: 'claude-code', seat: 'seat-a' });
    const codex = await harness.agent({ name: 'codex-mcp-client' });
    await keyed.call('join', { as: 'api', room: 'checkout' });
    await codex.call('join', { as: 'web', room: 'checkout', thread_id: LIVE_THREAD });
    harness.store.touch({ as: 'api', room: 'checkout', state: 'away' });
    harness.store.touch({ as: 'web', room: 'checkout', state: 'away' });
    harness.clock.advance(SEAT_TOKEN_FREE_AFTER_MS);
    const stranger = await harness.agent({ name: 'claude-code' });

    const api = await stranger.call('join', { as: 'api', room: 'checkout' });
    const web = await stranger.call('join', { as: 'web', room: 'checkout' });

    expect(api).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(web).toStrictEqual({ isError: true, text: 'name taken, try web-2.' });
  });

  it('gives no seat token to a session with a seat key, a codex thread or a client other than claude', async () => {
    const keyed = await harness.agent({ name: 'claude-code', seat: 'seat-a' });
    const codex = await harness.agent({ name: 'codex-mcp-client' });
    const other = await harness.agent();

    const replies = await Promise.all([
      keyed.call('join', { as: 'api', room: 'checkout' }),
      codex.call('join', { as: 'web', room: 'checkout', thread_id: LIVE_THREAD }),
      other.call('join', { as: 'ops', room: 'checkout' }),
    ]);

    replies.forEach(reply => expect(reply.text).not.toContain('seat token'));
  });

  it('hands an away seat back to codex by its thread id and to no other thread', async () => {
    const oldApi = await harness.agent({ name: 'codex-mcp-client' });
    await oldApi.call('join', { as: 'api', room: 'checkout', thread_id: LIVE_THREAD });
    harness.store.touch({ as: 'api', room: 'checkout', state: 'away' });
    const stranger = await harness.agent({ name: 'codex-mcp-client' });
    const newApi = await harness.agent({ name: 'codex-mcp-client' });

    const refused = await stranger.call('join', { as: 'api', room: 'checkout', thread_id: CLOSED_THREAD });
    const joined = await newApi.call('join', { as: 'api', room: 'checkout', thread_id: LIVE_THREAD });

    expect(refused).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(joined.text).toContain('reconnected #checkout as api');
  });

  it('refuses an idle name whose holder session still holds a stream', async () => {
    const oldApi = await harness.joined('checkout', 'api');
    oldApi.session.hold();
    harness.clock.advance(IDLE_AFTER_MS);
    harness.store.sweepPresence({ ringable: () => false });
    const newApi = await harness.agent();

    const result = await newApi.call('join', { as: 'api', room: 'checkout' });

    expect(result).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(oldApi.session.rooms.get('checkout')).toBe('api');
  });

  it('answers a repeat join under the same name without a refusal', async () => {
    const api = await harness.joined('checkout', 'api');

    const result = await api.call('join', { as: 'api', room: 'checkout' });

    expect(result.isError).toBe(false);
    expect(result.text).toContain('joined #checkout as api');
  });

  it('refuses a second name in a room the session already joined', async () => {
    const api = await harness.joined('checkout', 'api');

    const result = await api.call('join', { as: 'web', room: 'checkout' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'you are already in #checkout as api. call leave first to join under another name.',
    });
  });

  it('checks the codex thread with thread/read, stores it and reports the doorbell', async () => {
    const codex = await harness.agent();

    const result = await codex.call('join', { as: 'web', kind: 'codex', room: 'checkout', thread_id: LIVE_THREAD });

    expect(harness.codex.calls).toStrictEqual([{ method: 'thread/read', params: { threadId: LIVE_THREAD } }]);
    expect(codex.session.threadId).toBe(LIVE_THREAD);
    expect(result.text).toContain('doorbell: codex');
  });

  it.each([
    ['codex does not know', 'thread-123'],
    ['codex has not loaded', CLOSED_THREAD],
  ])('records no doorbell for a thread %s', async (_why, threadId) => {
    const codex = await harness.agent();

    const result = await codex.call('join', { as: 'web', kind: 'codex', room: 'checkout', thread_id: threadId });

    expect(result.isError).toBe(false);
    expect(codex.session.threadId).toBeUndefined();
    expect(result.text).toContain('doorbell: none (call wait)');
  });

  it('seats a codex agent by its invite token with the role made for it', async () => {
    harness.store.createRoom({ created_by: 'human', name: 'checkout' });
    const made = harness.store.invite({
      by: 'human',
      launch: { agent: 'codex', cwd: '/tmp/web' },
      name: 'web',
      role: 'reviewer',
      room: 'checkout',
    });
    if (!made.ok) throw new Error(made.reason);
    const codex = await harness.agent();

    const result = await codex.call('join', {
      as: 'web',
      invite: made.seatKey,
      kind: 'codex',
      room: 'checkout',
      thread_id: LIVE_THREAD,
    });

    expect(result.text).toContain('joined #checkout as web.');
    expect(result.text).toContain('your role in #checkout: reviewer');
    expect(harness.store.seatsOf(LIVE_THREAD)).toStrictEqual([{ kind: 'codex', name: 'web', room: 'checkout' }]);
  });

  it('refuses an invite token that matches no invite', async () => {
    harness.store.createRoom({ created_by: 'human', name: 'checkout' });
    const codex = await harness.agent();

    const result = await codex.call('join', { as: 'web', invite: 'made-up', kind: 'codex', room: 'checkout' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'no invite for web in #checkout. check the name and the invite, or join without one.',
    });
  });

  it('tells a codex member with no thread id that it has no doorbell', async () => {
    const codex = await harness.agent();

    const result = await codex.call('join', { as: 'web', kind: 'codex', room: 'checkout' });

    expect(harness.codex.calls).toStrictEqual([]);
    expect(result.text).toContain('doorbell: none (call wait)');
  });

  it('marks a crush session as rung by the channel and keeps its kind other', async () => {
    const crush = await harness.agent({ name: 'crush' });

    await crush.call('join', { as: 'crushy', room: 'checkout' });

    expect(crush.session.kind).toBe('other');
    expect(crush.session.channel).toBe(true);
  });

  it('does not mark a plain other client as rung by the channel', async () => {
    const other = await harness.agent({ name: 'gemini-cli' });

    await other.call('join', { as: 'web', room: 'checkout' });

    expect(other.session.channel).toBe(false);
  });

  it('stores the client name and version the agent sent at initialize', async () => {
    const crush = await harness.agent({ name: 'crush (via mcp-remote 0.14.3)', version: '0.97.1' });

    await crush.call('join', { as: 'web', room: 'checkout' });

    expect(harness.store.listMembers('checkout').find(member => member.name === 'web')).toMatchObject({
      client_label: 'crush',
      client_name: 'crush (via mcp-remote 0.14.3)',
      client_version: '0.97.1',
      kind: 'other',
    });
  });

  it('reads the kind from the known clients when the agent passes none', async () => {
    const codex = await harness.agent({ name: 'codex-mcp-client' });

    await codex.call('join', { as: 'web', room: 'checkout' });

    expect(codex.session.kind).toBe('codex');
  });

  it('leaves the doorbell line out for other kinds', async () => {
    const claude = await harness.agent();

    const result = await claude.call('join', { as: 'web', kind: 'claude', room: 'checkout' });

    expect(result.text).not.toContain('doorbell:');
  });
});
