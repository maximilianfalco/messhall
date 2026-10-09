import type { RunningAgent, RunningInviteResult } from '../../contracts/feed.ts';

import path from 'node:path';

type Invite = RunningInviteResult['invites'][number];

const NAME_MAX = 40;
const MID_TASK = 'If you are mid task, finish your step or ask your human first.';

/** The line that invites a running agent. A codex learns its thread id so the doorbell can reach it. */
export function joinLine({ agent, name, room }: { agent: RunningAgent; name: string; room: string }) {
  const intro = `The human invites you to #${room} in messhall.`;
  if (agent.reach === 'codex_thread') {
    return `${intro} Join #${room} as ${name} with the messhall tools, with thread_id set to ${agent.id}. ${MID_TASK}`;
  }
  if (agent.kind === 'codex') {
    return `${intro} Run echo $CODEX_THREAD_ID, then join #${room} as ${name} with the messhall tools, with thread_id set to that value. ${MID_TASK}`;
  }
  return `${intro} Join #${room} as ${name} with the messhall tools. ${MID_TASK}`;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, NAME_MAX) || 'agent';

function nextFree(base: string, taken: Set<string>) {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, NAME_MAX - String(n).length - 1)}-${n}`;
  taken.add(name);
  return name;
}

/** Invites running agents to `room`: queues the join line on a shared codex thread, and hands back a line to
 * copy for any other agent or a thread that refused it. Names come from the repo, made unique in the batch. */
export async function inviteRunning({
  agents,
  ids,
  queue,
  room,
}: {
  agents: RunningAgent[];
  ids: string[];
  queue: (threadId: string, text: string) => Promise<boolean>;
  room: string;
}) {
  const taken = new Set<string>();
  const picked = ids.map(id => {
    const agent = agents.find(found => found.id === id);
    if (!agent) return { agent, id, name: null };
    return { agent, id, name: nextFree(slug(agent.repo ?? path.basename(agent.cwd)), taken) };
  });
  return Promise.all(
    picked.map(async ({ agent, id, name }): Promise<Invite> => {
      if (!agent || !name) return { id, line: null, name: null, outcome: 'gone' };
      const line = joinLine({ agent, name, room });
      const queued = agent.reach === 'codex_thread' && (await queue(agent.id, line));
      return { id, line, name, outcome: queued ? 'queued' : 'copy' };
    }),
  );
}
