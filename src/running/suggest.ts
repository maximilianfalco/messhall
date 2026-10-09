import type { RoomSuggestion, RunningAgent } from '../../contracts/feed.ts';

import { roleFromFolder } from '../lib/names.js';

const TICKET_KEY = /(?:^|[^a-z0-9])([a-z]+-\d+)(?![0-9])/;

/** The first ticket key in a branch, like rm-1234, lower case. Null when it has none. */
export function ticketKey(branch: string) {
  return TICKET_KEY.exec(branch.toLowerCase())?.[1] ?? null;
}

const DEFAULT_BRANCHES = new Set(['main', 'master']);

function groupKey({ branch, repo }: RunningAgent) {
  if (!repo || !branch) return null;
  return ticketKey(branch) ?? (DEFAULT_BRANCHES.has(branch) ? null : `${repo}/${branch}`);
}

/** Groups running agents with no room that likely work on one thing: same ticket key in the branch, else same
 * repo and branch. Every checkout sits on the default branch, so that alone never groups. A group needs two agents. */
export function suggestRooms({ agents }: { agents: RunningAgent[] }) {
  const groups = Map.groupBy(
    agents.filter(agent => agent.room === null && groupKey(agent)),
    agent => groupKey(agent)!,
  );
  return [...groups].flatMap(([key, members]): RoomSuggestion[] => {
    const room = roleFromFolder(key);
    if (members.length < 2 || !room) return [];
    return [{ ids: members.map(member => member.id), key, room }];
  });
}
