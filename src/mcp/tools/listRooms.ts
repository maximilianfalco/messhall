import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { listRoomsInputSchema } from '../../../contracts/mcp.ts';
import { memberLabel } from '../render.js';

import { registerRoomTool, reply } from './registry.js';

/** Registers `list_rooms`: enough about every room to pick one without joining. */
export function registerListRooms(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'list_rooms', { deps, description, inputSchema: listRoomsInputSchema }, async () => {
    const rooms = store.listRooms();
    if (!rooms.length) return reply('no rooms yet. join one to make it.');
    const lines = rooms.flatMap(room => {
      const members = store.listMembers(room.name);
      // Every call stamps last seen, so the latest stamp is the room's last activity.
      const last = members.map(member => member.last_seen_at).reduce((a, b) => (a > b ? a : b), room.created_at);
      const as = session.rooms.get(room.name);
      const made = room.standing ? `standing (made by ${room.created_by})` : `made by ${room.created_by}`;
      return [
        `#${room.name} ${room.closed_at ? 'closed' : 'open'}, ${made}, topic ${room.topic ?? 'none'}, ${room.message_count}/${room.message_cap} posts, last activity ${last}`,
        `  members: ${members.map(member => memberLabel({ as, member })).join(', ')}`,
      ];
    });
    return reply([`${rooms.length} rooms:`, ...lines].join('\n'));
  });
}
