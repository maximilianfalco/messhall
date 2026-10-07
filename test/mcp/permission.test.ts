import type { McpServer } from '@modelcontextprotocol/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PERMISSION_METHOD, PERMISSION_REQUEST_METHOD, sendVerdict } from '../../src/mcp/permission.js';
import { createMesshallServer } from '../../src/mcp/server.js';
import { createSession, createSessionRegistry } from '../../src/mcp/session.js';
import { connectInMemory } from '../../src/mcp/testing.js';
import { fakeCodexRpc } from '../codex/fakeCodex.js';
import { scratchStore } from '../rooms/scratch.js';

const ASK = {
  description: 'Run the test suite',
  input_preview: '{"command": "pnpm test"}',
  request_id: 'abcde',
  tool_name: 'Bash',
};

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  scratch = scratchStore();
});

afterEach(() => {
  scratch.cleanup();
  vi.restoreAllMocks();
});

async function claude() {
  const session = createSession({ id: 'session-1', now: scratch.clock.now });
  const sessions = createSessionRegistry<{ session: typeof session }>();
  sessions.add({ session });
  let server: McpServer | undefined;
  const client = await connectInMemory(
    () => {
      server = createMesshallServer({
        codex: fakeCodexRpc({ threads: {} }),
        now: scratch.clock.now,
        session,
        sessions,
        store: scratch.store,
      });
      return server;
    },
    { name: 'claude-code' },
  );
  const verdicts: unknown[] = [];
  client.setNotificationHandler(
    PERMISSION_METHOD,
    { params: z.object({ behavior: z.string(), request_id: z.string() }) },
    params => {
      verdicts.push(params);
    },
  );
  const ask = async (params: Record<string, string> = ASK) => {
    await client.notification({ method: PERMISSION_REQUEST_METHOD, params });
    await vi.waitFor(() => {
      if (!scratch.store.pendingApprovals('demo').length) throw new Error('not stored yet');
    });
  };
  return { ask, client, server: server!, verdicts };
}

describe('permission relay', () => {
  it('declares the permission capability next to the channel', async () => {
    const { client } = await claude();

    expect(client.getServerCapabilities()?.experimental).toStrictEqual({
      'claude/channel': {},
      'claude/channel/permission': {},
    });
  });

  it('stores a tool ask on the seat the session holds', async () => {
    const { ask, client } = await claude();
    await client.callTool({ arguments: { as: 'api', room: 'demo' }, name: 'join' });

    await ask();

    expect(scratch.store.pendingApprovals('demo')).toMatchObject([
      {
        description: 'Run the test suite',
        input_preview: '{"command": "pnpm test"}',
        member: 'api',
        state: 'pending',
        tool: 'Bash',
      },
    ]);
  });

  it('stores nothing for a session that holds no seat', async () => {
    const { client } = await claude();
    scratch.store.joinRoom({ as: 'web', kind: 'claude', room: 'demo' });

    await client.notification({ method: PERMISSION_REQUEST_METHOD, params: ASK });
    await client.listTools();

    expect(scratch.store.pendingApprovals('demo')).toStrictEqual([]);
  });

  it('sends the verdict with the request id the client issued', async () => {
    const { server, verdicts } = await claude();

    await expect(sendVerdict(server, { behavior: 'allow', requestId: 'abcde' })).resolves.toBe(true);

    await vi.waitFor(() => {
      expect(verdicts).toStrictEqual([{ behavior: 'allow', request_id: 'abcde' }]);
    });
  });

  it('says false when the session is gone', async () => {
    const { client, server } = await claude();
    await client.close();

    await expect(sendVerdict(server, { behavior: 'deny', requestId: 'abcde' })).resolves.toBe(false);
  });

  it('offers no tool that answers an ask', async () => {
    const { client } = await claude();

    const { tools } = await client.listTools();

    expect(
      tools.map(tool => tool.name).filter(name => /approv|permission|allow|deny|verdict/.test(name)),
    ).toStrictEqual([]);
  });
});
