import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { leaveInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, registerRoomTool, reply } from './registry.js';

/** Registers `leave`: a system line for the room, and the room unbound from this session. */
export function registerLeave(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'leave', { deps, description, inputSchema: leaveInputSchema }, async ({ note, room }) => {
    const as = session.rooms.get(room);
    if (!as) return notJoined(room);
    session.unbind(room);
    const left = store.leaveRoom({ as, note, room });
    return left.ok ? reply(`left #${room}.`) : notJoined(room);
  });
}
