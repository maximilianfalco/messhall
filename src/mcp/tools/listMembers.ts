import type { Member } from '../../../contracts/room.ts';
import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { listMembersInputSchema } from '../../../contracts/mcp.ts';
import { memberLabel } from '../render.js';

import { refuse, registerRoomTool, reply } from './registry.js';

/** Registers `list_members`: anyone may look before they join. */
export function registerListMembers(server: McpServer, deps: ToolDeps, description: string) {
  const { session, sessions, store } = deps;
  registerRoomTool(
    server,
    'list_members',
    { deps, description, inputSchema: listMembersInputSchema },
    async ({ room }) => {
      if (!store.listRooms().some(item => item.name === room)) {
        return refuse(`no room #${room}. call list_rooms to see the rooms, or join to make it.`);
      }
      const as = session.rooms.get(room);
      const members = store.listMembers(room);
      const noDoorbell = (member: Member) => {
        const held = sessions.sessionsFor({ name: member.name, room }).map(entry => entry.session);
        if (member.kind === 'codex') return !held.some(one => one.threadId);
        return held.some(one => one.doorbell === 'off') && !held.some(one => one.doorbell === 'on');
      };
      return reply(
        [
          `#${room}, ${members.length} members:`,
          ...members.map(
            member =>
              `- ${memberLabel({ as, member, noDoorbell: noDoorbell(member) })}, last seen ${member.last_seen_at}`,
          ),
        ].join('\n'),
      );
    },
  );
}
