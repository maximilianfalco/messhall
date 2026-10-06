import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { setTopicInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, reply } from './registry.js';

/** Registers `set_topic`: the store checks that the caller made the room or is an orchestrator. */
export function registerSetTopic(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'set_topic',
    { deps, description, inputSchema: setTopicInputSchema },
    async ({ room, topic }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const result = store.setTopic({ by: as, room, topic });
      if (result.ok) return reply(`topic of #${room} is now: ${topic}`);
      switch (result.reason) {
        case 'not_allowed': {
          const maker = store.listRooms().find(item => item.name === room)?.created_by;
          return refuse(
            `only ${maker} (who made #${room}), an orchestrator or the human can set the topic. ask one of them.`,
          );
        }
        case 'muted':
          return refuse(`you are muted in #${room}, so you cannot set the topic. wait for the human to unmute you.`);
        case 'room_closed':
          return refuse('room is closed, ask the human to reopen.');
        default:
          session.unbind(room);
          return notJoined(room);
      }
    },
  );
}
