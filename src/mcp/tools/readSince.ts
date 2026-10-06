import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { readSinceInputSchema } from '../../../contracts/mcp.ts';
import { renderRead } from '../render.js';

import { notJoined, registerRoomTool, reply } from './registry.js';

/** Registers `read_since`: unseen messages as a labeled block, moving the bookmark unless `after_id` is set. */
export function registerReadSince(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'read_since', { deps, description, inputSchema: readSinceInputSchema }, async input => {
    const as = session.rooms.get(input.room);
    if (!as) return notJoined(input.room);
    const read = store.readUnseen({ afterId: input.after_id, as, room: input.room });
    if (!read.ok) {
      session.unbind(input.room);
      return notJoined(input.room);
    }
    return reply(renderRead({ as, messages: read.messages, more: read.more, room: input.room }));
  });
}
