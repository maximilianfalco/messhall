import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { kickInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, removedFrom, reply } from './registry.js';

/** Registers `kick`: the store checks that the caller is an orchestrator before anything changes. */
export function registerKick(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'kick', { deps, description, inputSchema: kickInputSchema }, async ({ member, room }) => {
    const as = session.rooms.get(room);
    if (!as) return notJoined(room);
    const kicked = store.kickMember({ by: as, member, room });
    if (kicked.ok) return reply(`${member} is out of #${room}.`);
    switch (kicked.reason) {
      case 'not_allowed':
        return refuse(`only the human or an orchestrator can kick in #${room}. ask @orchestrator or the human.`);
      case 'human':
        return refuse('the human seat cannot be kicked.');
      case 'no_member':
        return refuse(`no member ${member} in #${room}. call list_members to see who is here.`);
      default:
        return removedFrom(session, room);
    }
  });
}
