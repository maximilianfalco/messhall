import type { RoomSuggestion, RunningAgent } from './types.js';

const TICKET_KEY = /(?:^|[^a-z0-9])([a-z]+-\d+)(?![0-9])/;
const ROOM_NAME_MAX = 40;

/** The first ticket key in a branch, like rm-1234, lower case. Null when it has none. */
export function ticketKey(branch: string) {
  return TICKET_KEY.exec(branch.toLowerCase())?.[1] ?? null;
}

const roomName = (key: string) =>
  key
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, ROOM_NAME_MAX);

function groupKey({ branch, repo }: RunningAgent) {
  if (!repo || !branch) return null;
  return ticketKey(branch) ?? `${repo}/${branch}`;
}

/** Groups running agents that likely work on one thing: same ticket key in the branch, else same repo and branch.
 * A group needs two agents, and is left out when all of them already sit in one room. */
export function suggestRooms({ agents }: { agents: RunningAgent[] }) {
  const groups = Map.groupBy(
    agents.filter(agent => groupKey(agent)),
    agent => groupKey(agent)!,
  );
  return [...groups].flatMap(([key, members]): RoomSuggestion[] => {
    if (members.length < 2) return [];
    const rooms = new Set(members.map(member => member.room));
    if (rooms.size === 1 && !rooms.has(null)) return [];
    return [{ ids: members.map(member => member.id), key, room: roomName(key) }];
  });
}
