import type { McpSession } from '../../src/mcp/session.js';
import type { ToolDeps } from '../../src/mcp/tools/registry.js';
import type { Client, RequestOptions } from '@modelcontextprotocol/client';

import { vi } from 'vitest';

import { createMesshallServer } from '../../src/mcp/server.js';
import { createSession, createSessionRegistry } from '../../src/mcp/session.js';
import { connectInMemory, scratchSpawner } from '../../src/mcp/testing.js';
import { fakeCodexRpc } from '../codex/fakeCodex.js';
import { scratchStore } from '../rooms/scratch.js';

type CallResult = Awaited<ReturnType<Client['callTool']>>;

export const textOf = (result: CallResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');

export const LIVE_THREAD = '01a10e95-f79c-7573-8c27-8f50dbc18a59';
export const CLOSED_THREAD = '01a10e95-0000-7000-8000-000000000000';

type Scratch = ReturnType<typeof scratchStore>;

/** A scratch store, a session registry and a fake Codex that any number of in-memory agents share.
 * The spawner starts nothing unless a test passes its own. */
export function mcpHarness({ spawner: makeSpawner }: { spawner?: (scratch: Scratch) => ToolDeps['spawner'] } = {}) {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const scratch = scratchStore();
  const spawner = makeSpawner ? makeSpawner(scratch) : scratchSpawner;
  const sessions = createSessionRegistry<{ session: McpSession }>();
  const clients: Client[] = [];
  const codex = fakeCodexRpc({ threads: { [CLOSED_THREAD]: 'notLoaded', [LIVE_THREAD]: 'idle' } });

  async function agent({
    name: clientName,
    roots,
    seat,
    version,
  }: { name?: string; roots?: string[]; seat?: string; version?: string } = {}) {
    const session = createSession({ id: `session-${clients.length + 1}`, now: scratch.clock.now, seat });
    sessions.add({ session });
    const client = await connectInMemory(
      () => createMesshallServer({ codex, now: scratch.clock.now, session, sessions, spawner, store: scratch.store }),
      { name: clientName, roots, version },
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

  /** Joins as `orchestrator` and has the human give it the role, the only way an agent gets it. */
  async function orchestrator(room: string) {
    const member = await joined(room, 'orchestrator');
    scratch.store.assignRole({ by: 'human', member: 'orchestrator', role: 'orchestrator', room });
    return member;
  }

  function summary(input: { coversId: number; room: string; text: string }) {
    const result = scratch.store.addSummary(input);
    if (!result.ok) throw new Error(result.reason);
    return result.message;
  }

  return {
    agent,
    async cleanup() {
      await Promise.all(clients.map(client => client.close()));
      scratch.cleanup();
      vi.restoreAllMocks();
    },
    clock: scratch.clock,
    codex,
    dataDir: scratch.dataDir,
    get db() {
      return scratch.db;
    },
    joined,
    orchestrator,
    sessions,
    summary,
    get store() {
      return scratch.store;
    },
  };
}

export type McpHarness = ReturnType<typeof mcpHarness>;
