import type { RunningAgent, RunningInviteItem } from '../../contracts/feed.ts';
import type { typeIfClear } from '../flock/tmux.js';
import type { ScannedAgent } from './running.js';

import path from 'node:path';

import { roleFromFolder } from '../lib/names.js';

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

function nextFree(base: string, taken: Set<string>) {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, NAME_MAX - String(n).length - 1)}-${n}`;
  taken.add(name);
  return name;
}

/** The ways a join line goes out on its own: a codex thread queue, a claude channel ring, keys typed in a tmux pane. */
export interface Deliver {
  queue: (threadId: string, text: string) => Promise<boolean>;
  ring: (session: string, text: string) => Promise<boolean>;
  type: (pane: string, text: string) => ReturnType<typeof typeIfClear>;
}

type Delivered = Pick<RunningInviteItem, 'outcome' | 'why'>;

const copy = (why: string): Delivered => ({ outcome: 'copy', why });

const UNTYPED = {
  draft: 'its tmux pane had a draft in the input box, so nothing was typed',
  menu: 'its tmux pane had a menu open, so nothing was typed',
  not_ready: 'its tmux pane did not show claude at its prompt, so nothing was typed',
  stuck: 'the line sits in the input box of its tmux pane, press enter there',
} as const;

// Keys typed into a working claude would land in the middle of its turn, so only an idle one gets them.
async function send(agent: ScannedAgent, line: string, deliver: Deliver): Promise<Delivered> {
  switch (agent.reach) {
    case 'codex_thread':
      return (await deliver.queue(agent.id, line))
        ? { outcome: 'queued', why: null }
        : copy('its codex thread refused the line');
    case 'claude_channel':
      return agent.target && (await deliver.ring(agent.target, line))
        ? { outcome: 'sent', why: null }
        : copy('its messhall channel closed, so nothing was sent');
    case 'tmux_pane': {
      if (agent.status !== 'idle' || !agent.target) return copy('it was busy in its tmux pane, so nothing was typed');
      const typed = await deliver.type(agent.target, line);
      return typed === 'sent' ? { outcome: 'sent', why: null } : copy(UNTYPED[typed]);
    }
    default:
      return copy(`started outside messhall, start it with messhall ${agent.kind} next time`);
  }
}

/** Invites running agents to `room`: rings a claude messhall started, types into the tmux pane of an idle claude,
 * queues on a shared codex thread, and hands back a line to copy, with the reason, for the rest.
 * Names come from the repo, made unique in the batch. */
export async function inviteRunning({
  agents,
  deliver,
  ids,
  room,
}: {
  agents: ScannedAgent[];
  deliver: Deliver;
  ids: string[];
  room: string;
}) {
  const taken = new Set<string>();
  const picked = ids.map(id => {
    const agent = agents.find(found => found.id === id);
    if (!agent) return { agent, id, name: null };
    return { agent, id, name: nextFree(roleFromFolder(agent.repo ?? path.basename(agent.cwd)) ?? 'agent', taken) };
  });
  return Promise.all(
    picked.map(async ({ agent, id, name }): Promise<RunningInviteItem> => {
      if (!agent || !name) return { id, line: null, name: null, outcome: 'gone', why: null };
      const line = joinLine({ agent, name, room });
      return { id, line, name, ...(await send(agent, line, deliver)) };
    }),
  );
}
