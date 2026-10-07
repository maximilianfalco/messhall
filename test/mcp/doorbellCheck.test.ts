import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DOORBELL_CHECK_MS } from '../../src/config.js';
import { CHANNEL_METHOD } from '../../src/doorbell/ringers/channel.js';
import { createSession } from '../../src/mcp/session.js';

import { mcpHarness, type McpHarness } from './harness.js';

const NO_DOORBELL =
  'doorbell: off. no answer came to the test ring, so nothing rings this session. start it with `messhall claude`, or call wait in a loop while you wait on others.';

function clock() {
  let at = Date.parse('2026-01-01T10:00:00.000Z');
  return {
    advance(ms: number) {
      at += ms;
    },
    now: () => new Date(at),
  };
}

describe('the doorbell check on a session', () => {
  it('stays unchecked until a check starts', () => {
    const session = createSession({ id: 's1', now: clock().now });

    expect(session.doorbell).toBe('unchecked');
  });

  it('reads on when the ack comes in time', () => {
    const time = clock();
    const session = createSession({ id: 's1', now: time.now });
    session.checkDoorbell('ring-1');
    time.advance(DOORBELL_CHECK_MS - 1);

    expect(session.doorbell).toBe('checking');
    expect(session.ackDoorbell('ring-1')).toBe(true);
    expect(session.doorbell).toBe('on');
  });

  it('reads off once the check times out with no ack', () => {
    const time = clock();
    const session = createSession({ id: 's1', now: time.now });
    session.bind({ channel: true, kind: 'claude', name: 'api', room: 'checkout' });
    session.checkDoorbell('ring-1');
    time.advance(DOORBELL_CHECK_MS);

    expect(session.doorbell).toBe('off');
    expect(session.ringable).toBe(true);
  });

  it('turns back on when the ack comes late', () => {
    const time = clock();
    const session = createSession({ id: 's1', now: time.now });
    session.bind({ channel: true, kind: 'claude', name: 'api', room: 'checkout' });
    session.checkDoorbell('ring-1');
    time.advance(DOORBELL_CHECK_MS * 3);

    expect(session.ackDoorbell('ring-1')).toBe(true);
    expect(session.doorbell).toBe('on');
    expect(session.ringable).toBe(true);
  });

  it('ignores an ack with the wrong id', () => {
    const session = createSession({ id: 's1', now: clock().now });
    session.checkDoorbell('ring-1');

    expect(session.ackDoorbell('ring-2')).toBe(false);
    expect(session.doorbell).toBe('checking');
  });
});

describe('the doorbell check over mcp', () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = mcpHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  async function claude() {
    const agent = await harness.agent({ name: 'claude-code', version: '2.1.293' });
    const rings: { content: string; meta: Record<string, string> }[] = [];
    agent.client.setNotificationHandler(
      CHANNEL_METHOD,
      { params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) },
      params => {
        rings.push(params);
      },
    );
    return { ...agent, rings };
  }

  it('sends one test ring after the first join and says so in the reply', async () => {
    const api = await claude();

    const result = await api.call('join', { as: 'api', room: 'checkout' });
    await api.call('join', { as: 'api', room: 'auth' });

    expect(result.text).toContain('doorbell: checking. a test ring follows, answer it with doorbell_ok.');
    await vi.waitFor(() => expect(api.rings).toHaveLength(1));
    expect(api.rings[0]!.content).toMatch(/^doorbell check: call doorbell_ok with id \S+\./);
  });

  it('turns the doorbell on when doorbell_ok carries the ring id', async () => {
    const api = await claude();
    await api.call('join', { as: 'api', room: 'checkout' });
    await vi.waitFor(() => expect(api.rings).toHaveLength(1));
    const id = api.rings[0]!.meta.doorbell_check!;

    const result = await api.call('doorbell_ok', { id });

    expect(result).toStrictEqual({
      isError: false,
      text: 'doorbell on: a mention, @all or a human line now rings this session.',
    });
    expect(api.session.doorbell).toBe('on');
  });

  it('refuses doorbell_ok with an id it never sent', async () => {
    const api = await claude();
    await api.call('join', { as: 'api', room: 'checkout' });

    const result = await api.call('doorbell_ok', { id: 'made-up' });

    expect(result.isError).toBe(true);
    expect(api.session.doorbell).toBe('checking');
  });

  it('tells a session with no answer once, on its next call, and shows it as no doorbell', async () => {
    const api = await claude();
    await api.call('join', { as: 'api', room: 'checkout' });
    harness.clock.advance(DOORBELL_CHECK_MS);

    const first = await api.call('read_since', { room: 'checkout' });
    const second = await api.call('list_members', { room: 'checkout' });

    expect(first.text.split('\n').at(-1)).toBe(NO_DOORBELL);
    expect(second.text).not.toContain(NO_DOORBELL);
    expect(second.text).toContain('- api (claude 2.1.293 (no doorbell), active, you)');
  });

  it('says the doorbell is off on a join after the check timed out', async () => {
    const api = await claude();
    await api.call('join', { as: 'api', room: 'checkout' });
    harness.clock.advance(DOORBELL_CHECK_MS);

    const result = await api.call('join', { as: 'api', room: 'auth' });

    expect(result.text).toContain(NO_DOORBELL);
    expect(result.text).not.toContain('doorbell: checking');
  });

  it('sends no test ring to a client that takes no channel', async () => {
    const gemini = await harness.agent({ name: 'gemini-cli' });

    const result = await gemini.call('join', { as: 'web', room: 'checkout' });

    expect(gemini.session.doorbell).toBe('unchecked');
    expect(result.text).not.toContain('doorbell:');
  });
});
