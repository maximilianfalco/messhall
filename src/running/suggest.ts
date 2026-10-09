import type { RoomSuggestion, RunningAgent } from '../../contracts/feed.ts';

import { roleFromFolder } from '../lib/names.js';

const TICKET_KEY = /(?:^|[^a-z0-9])([a-z]+-\d+)(?![0-9])/;

/** The first ticket key in a branch, like rm-1234, lower case. Null when it has none. */
export function ticketKey(branch: string) {
  return TICKET_KEY.exec(branch.toLowerCase())?.[1] ?? null;
}

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
    const room = roleFromFolder(key);
    if (!room || (rooms.size === 1 && !rooms.has(null))) return [];
    return [{ ids: members.map(member => member.id), key, room }];
  });
}
