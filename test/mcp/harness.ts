import type { McpSession } from '../../src/mcp/session.js';
import type { Client, RequestOptions } from '@modelcontextprotocol/client';

import { vi } from 'vitest';

import { createMesshallServer } from '../../src/mcp/server.js';
import { createSession, createSessionRegistry } from '../../src/mcp/session.js';
import { connectInMemory } from '../../src/mcp/testing.js';
import { scratchStore } from '../rooms/scratch.js';

type CallResult = Awaited<ReturnType<Client['callTool']>>;

export const textOf = (result: CallResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');

/** A scratch store and a session registry that any number of in-memory agents share. */
export function mcpHarness() {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const scratch = scratchStore();
  const sessions = createSessionRegistry<{ session: McpSession }>();
  const clients: Client[] = [];

  async function agent({ roots }: { roots?: string[] } = {}) {
    const session = createSession({ id: `session-${clients.length + 1}`, now: scratch.clock.now });
    sessions.add({ session });
    const client = await connectInMemory(
      () => createMesshallServer({ now: scratch.clock.now, session, sessions, store: scratch.store }),
      { roots },
    );
    clients.push(client);
    const call = async (name: string, args: Record<string, unknown> = {}, options?: RequestOptions) => {
      const result = await client.callTool({ arguments: args, name }, options);
      return { isError: Boolean(result.isError), text: textOf(result) };
    };
    return { call, client, session };
  }

  async function joined(room: string, as: string) {
    const member = await agent();
    await member.call('join', { as, room });
    return member;
  }

  return {
    agent,
    async cleanup() {
      await Promise.all(clients.map(client => client.close()));
      scratch.cleanup();
      vi.restoreAllMocks();
    },
    clock: scratch.clock,
    joined,
    sessions,
    get store() {
      return scratch.store;
    },
  };
}

export type McpHarness = ReturnType<typeof mcpHarness>;
