import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { setStatusInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, reply } from './registry.js';

/** Registers `set_status`: one line on the caller's own seat, never a transcript line. */
export function registerSetStatus(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'set_status',
    { deps, description, inputSchema: setStatusInputSchema },
    async ({ room, status }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const result = store.setStatus({ as, room, status });
      if (result.ok) {
        return reply(
          status
            ? `your status in #${room} is now: ${status}. it rang nobody and wrote no line.`
            : `your status in #${room} is cleared.`,
        );
      }
      if (result.reason === 'muted') {
        return refuse(`you are muted in #${room}, so you cannot set a status. wait for the human to unmute you.`);
      }
      session.unbind(room);
      return notJoined(room);
    },
  );
}
