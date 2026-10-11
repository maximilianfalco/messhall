import type { RoomSuggestion, RunningAgent } from '../../contracts/feed.ts';

import { roleFromFolder } from '../lib/names.js';

const TICKET_KEY = /(?:^|[^a-z0-9])([a-z]+-\d+)(?![0-9])/;

/** The first ticket key in a branch, like rm-1234, lower case. Null when it has none. */
export function ticketKey(branch: string) {
  return TICKET_KEY.exec(branch.toLowerCase())?.[1] ?? null;
}

const DEFAULT_BRANCHES = new Set(['main', 'master']);

/** Groups running agents that likely work on one thing: same ticket key in the branch, else same repo and
 * branch. Every checkout sits on the default branch (main, master or `isDefault`), so that alone never groups.
 * A group needs two agents and one with no room. It invites only the roomless ones, into the room the rest share. */
export function suggestRooms({
  agents,
  isDefault = () => false,
}: {
  agents: RunningAgent[];
  isDefault?: (agent: RunningAgent) => boolean;
}) {
  const keyOf = (agent: RunningAgent) => {
    const { branch, repo } = agent;
    if (!repo || !branch) return null;
    return ticketKey(branch) ?? (DEFAULT_BRANCHES.has(branch) || isDefault(agent) ? null : `${repo}/${branch}`);
  };
  const groups = Map.groupBy(
    agents.filter(agent => keyOf(agent)),
    agent => keyOf(agent)!,
  );
  return [...groups].flatMap(([key, members]): RoomSuggestion[] => {
    const ids = members.filter(member => member.room === null).map(member => member.id);
    const rooms = new Set(members.flatMap(member => (member.room === null ? [] : [member.room])));
    const room = rooms.size === 1 ? [...rooms][0]! : roleFromFolder(key);
    if (members.length < 2 || ids.length === 0 || !room) return [];
    return [{ ids, key, room }];
  });
}
