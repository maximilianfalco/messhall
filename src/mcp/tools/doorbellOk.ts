import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { doorbellOkInputSchema } from '../../../contracts/mcp.ts';

import { refuse, registerRoomTool, reply } from './registry.js';

/** Registers `doorbell_ok`: the answer to this session's test ring, which marks its doorbell on. */
export function registerDoorbellOk(server: McpServer, deps: ToolDeps, description: string) {
  const { session } = deps;
  registerRoomTool(server, 'doorbell_ok', { deps, description, inputSchema: doorbellOkInputSchema }, async ({ id }) =>
    session.ackDoorbell(id)
      ? reply('doorbell on: a mention, @all or a human line now rings this session.')
      : refuse('no doorbell check with that id here. use the id from the doorbell check ring this session got.'),
  );
}
