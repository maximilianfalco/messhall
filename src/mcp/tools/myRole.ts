import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { myRoleInputSchema } from '../../../contracts/mcp.ts';
import { roleBlock } from '../render.js';

import { notJoined, registerRoomTool, reply } from './registry.js';

/** Registers `my_role`: the caller's role in a room with the instructions that came with it. */
export function registerMyRole(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'my_role', { deps, description, inputSchema: myRoleInputSchema }, async ({ room }) => {
    const as = session.rooms.get(room);
    const role = as ? store.roleOf({ name: as, room }) : undefined;
    if (!role) return notJoined(room);
    return reply(roleBlock({ role, room }).join('\n'));
  });
}
