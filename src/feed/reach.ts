import type { Reach } from '../../contracts/room.ts';
import type { McpSession } from '../mcp/session.js';
import type { RoomStore } from '../rooms/store.js';

export type ReachOf = (seat: { name: string; room: string }) => Reach | undefined;

/**
 * How messhall reaches a seat, undefined for the human or a member who left. A spawned seat reads spawned
 * whatever its doorbell says. A channel session still being checked reads doorbell until its test ring fails.
 */
export function createReachOf({
  sessionsFor,
  store,
}: {
  sessionsFor: (seat: { name: string; room: string }) => { session: Pick<McpSession, 'doorbell' | 'ringable'> }[];
  store: RoomStore;
}): ReachOf {
  return ({ name, room }) => {
    const member = store.listMembers(room).find(item => item.name === name);
    if (!member || member.kind === 'human') return;
    if (store.launchOf({ name, room })) return 'spawned';
    const rings = sessionsFor({ name, room }).some(
      ({ session }) => session.doorbell === 'on' || (session.ringable && session.doorbell !== 'off'),
    );
    return rings ? 'doorbell' : 'no_doorbell';
  };
}
