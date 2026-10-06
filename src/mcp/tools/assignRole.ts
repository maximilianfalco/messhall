import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { assignRoleInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, reply } from './registry.js';

/** Registers `assign_role`: the store checks that the caller is an orchestrator before anything changes. */
export function registerAssignRole(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'assign_role',
    { deps, description, inputSchema: assignRoleInputSchema },
    async ({ instructions, member, role, room }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const assigned = store.assignRole({ by: as, instructions, member, role, room });
      if (assigned.ok) return reply(`${member} is now ${role} in #${room}.`);
      switch (assigned.reason) {
        case 'not_allowed':
          return refuse(`only the human or an orchestrator can set roles in #${room}. ask @orchestrator or the human.`);
        case 'no_member':
          return refuse(`no member ${member} in #${room}. call list_members to see who is here.`);
        default:
          session.unbind(room);
          return notJoined(room);
      }
    },
  );
}
