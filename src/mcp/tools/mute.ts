import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { muteInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, reply } from './registry.js';

/** Registers `mute`: the store checks that the caller is an orchestrator before anything changes. */
export function registerMute(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'mute',
    { deps, description, inputSchema: muteInputSchema },
    async ({ member, room, unmute = false }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const result = store.muteMember({ by: as, member, muted: !unmute, room });
      if (result.ok) return reply(`${member} is ${unmute ? 'unmuted' : 'muted'} in #${room}.`);
      switch (result.reason) {
        case 'not_allowed':
          return refuse(`only the human or an orchestrator can mute in #${room}. ask @orchestrator or the human.`);
        case 'muted':
          return refuse(`you are muted in #${room}, so you cannot mute or unmute. wait for the human to unmute you.`);
        case 'human':
          return refuse('the human cannot be muted.');
        case 'no_member':
          return refuse(`no member ${member} in #${room}. call list_members to see who is here.`);
        default:
          session.unbind(room);
          return notJoined(room);
      }
    },
  );
}
