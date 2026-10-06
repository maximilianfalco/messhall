import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { postInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, reply } from './registry.js';

/** Registers `post`: membership, the open room, the cap and the text limit all come from the store. */
export function registerPost(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'post',
    { deps, description, inputSchema: postInputSchema },
    async ({ done, room, text }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const posted = store.postMessage({ done, from: as, room, text });
      if (posted.ok) {
        const { mentions } = posted.message;
        const mentioned = mentions.length ? `, mentioned ${mentions.map(name => `@${name}`).join(' ')}` : '';
        return reply(`posted #${posted.message.id} in #${room}${mentioned}.`);
      }
      switch (posted.reason) {
        case 'too_long':
          return refuse(`too long (${posted.length} chars). Write it to a file and post the path.`);
        case 'room_full':
          return refuse('room closed at its cap, ask the human to reopen.');
        case 'room_closed':
          return refuse(`#${room} is closed, every agent said done. ask the human to post or reopen it.`);
        default:
          session.unbind(room);
          return notJoined(room);
      }
    },
  );
}
