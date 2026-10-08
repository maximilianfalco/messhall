import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { spawnInputSchema } from '../../../contracts/mcp.ts';
import { SPAWN_RATE_MAX } from '../../config.js';
import { canAssignRole } from '../../rooms/rules.js';

import { notJoined, refuse, registerRoomTool, removedFrom, reply } from './registry.js';

/** Registers `spawn`: an orchestrator starts an agent through the daemon's spawner.
 * The caller is checked before the cwd is looked at, and the store checks it again as it makes the seat. */
export function registerSpawn(server: McpServer, deps: ToolDeps, description: string) {
  const { session, spawner, store } = deps;
  registerRoomTool(
    server,
    'spawn',
    { deps, description, inputSchema: spawnInputSchema },
    async ({ agent = 'claude', cwd, instructions, model, name, role, room }) => {
      const muted = () => refuse(`you are muted in #${room}, so you cannot spawn. wait for the human to unmute you.`);
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const caller = store.listMembers(room).find(member => member.name === as);
      if (!caller) return removedFrom(session, room);
      if (!canAssignRole({ by: caller })) {
        return refuse(`only an orchestrator can spawn in #${room}. ask @orchestrator or the human.`);
      }
      if (caller.muted) return muted();

      const launch = { agent, cwd, ...(model ? { model } : {}) };
      const result = await spawner.spawn({ by: as, instructions, launch, name, role, room });
      if (result.ok) {
        return reply(
          `${name} sits in #${room} as ${role}, in tmux session ${result.session}. it reads its role with my_role.`,
        );
      }
      switch (result.reason) {
        case 'no_cwd':
          return refuse(`cwd ${cwd} is not a folder. give a full path that exists.`);
        case 'not_allowed':
          return refuse('an orchestrator cannot start another orchestrator. ask the human with ask_human.');
        case 'muted':
          return muted();
        case 'seat_cap':
          return refuse(
            `#${room} is at its cap of ${result.cap} spawned seats, and the human was told. kick a seat that is done, or wait for the human.`,
          );
        case 'spawn_rate':
          return refuse(`you spawned ${SPAWN_RATE_MAX} seats in the last minute. wait a minute, then spawn again.`);
        case 'name_reserved':
          return refuse(`${name} is reserved. pick another name.`);
        case 'name_taken':
          return refuse(`${name} is taken in #${room}. try ${result.suggestion}.`);
        case 'room_closed':
          return refuse(`#${room} is closed.`);
        case 'tmux':
          return refuse(`tmux could not start: ${result.detail}. tell the human.`);
        case 'untrusted':
          return refuse(
            `${agent} asks to trust ${cwd}, and only the human can trust a folder. ask the human to start an agent there once, then spawn again.`,
          );
        case 'no_room':
        case 'not_member':
          return removedFrom(session, room);
        default:
          return refuse(`${agent} did not take its seat (${result.reason}), so the seat is dropped. tell the human.`);
      }
    },
  );
}
