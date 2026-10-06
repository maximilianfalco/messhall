import { SERVER_NAME } from '../../../src/mcp/constants.js';

import { claudeArgv } from './claudeTmux.js';

export const SPAWN_SESSION_PREFIX = 'messhall-';
// A build agent works alone, so it gets the usual tools, not the demo's short list.
export const SPAWN_ALLOWED_TOOLS = [
  `mcp__${SERVER_NAME}`,
  'Bash',
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Skill',
  'Agent',
  'TodoWrite',
];

const ROW_LINE =
  /^(?<id>\S+)\s+(?<status>\S+)\s+\[[^\]]*\](?: branch=`(?<branch>[^`]*)`)?(?: owner=(?<owner>.*?))?(?: waits on (?<waits>\S+(?:, \S+)*))? {2}(?<job>.*)$/;
const SESSION = new RegExp(`^${SPAWN_SESSION_PREFIX}([A-Z]\\d+)$`);

export interface QueueRow {
  branch: string;
  id: string;
  job: string;
  owner: string;
  status: string;
  waitsOn: string[];
}

export interface FlockPane {
  pane: string;
  pid: number;
  row: string;
  session: string;
}

export const sessionName = (id: string) => `${SPAWN_SESSION_PREFIX}${id}`;
export const branchSlug = (branch: string) => branch.replaceAll('/', '-');

/** Finds row `id` in the output of `queue.py show --all`. */
export function parseQueueRow({ id, listing }: { id: string; listing: string }) {
  const rows = listing.split('\n').flatMap(line => {
    const groups = ROW_LINE.exec(line)?.groups;
    return groups ? [groups] : [];
  });
  const found = rows.find(groups => groups.id!.toLowerCase() === id.toLowerCase());
  if (!found) return;
  return {
    branch: found.branch ?? '',
    id: found.id!,
    job: found.job!,
    owner: found.owner ?? '',
    status: found.status!,
    waitsOn: found.waits ? found.waits.split(', ') : [],
  } satisfies QueueRow;
}

/** Whether row `id` can be spawned: open, every need done and a branch to build on. */
export function spawnPlan({ id, listing }: { id: string; listing: string }) {
  const row = parseQueueRow({ id, listing });
  const refuse = (reason: string) => ({ ok: false, reason }) as const;
  if (!row) return refuse(`no row ${id} in the queue`);
  if (row.status !== 'open') return refuse(`${row.id} is ${row.status}, not open`);
  if (row.waitsOn.length) return refuse(`${row.id} still waits on ${row.waitsOn.join(', ')}`);
  if (!row.branch) return refuse(`${row.id} has no branch to build on`);
  return { ok: true, row, session: sessionName(row.id), slug: branchSlug(row.branch) } as const;
}

/** The first prompt, one line since a newline would send it early. The row is claimed before it is typed. */
export function spawnPrompt({
  branch,
  brief,
  id,
  room,
  worktree,
}: {
  branch: string;
  brief?: string;
  id: string;
  room: string;
  worktree: string;
}) {
  const slug = branchSlug(branch);
  const start = brief
    ? `Read ${brief} first and follow it. Your job is row ${id} of the job queue, branch ${branch}.`
    : `Run /messhall-pickup-any-work ${id}, branch ${branch}.`;
  return [
    start,
    `The row is already claimed for you and your worktree is ${worktree}, so skip the claim and worktree steps.`,
    `Use the messhall tools for your seat, not a fifo or a script: join #${room} as ${slug} now and keep the seat, never call leave until the row is closed.`,
    `Post one short line in #${room} at each point: claimed, tests green, PR open (with the url), CI result, merged.`,
    `When the channel rings you, or a human line or a mention of you lands, read it and answer in #${room} right away, then go back to work.`,
    `When the row is closed, post with done: true and the PR url.`,
  ].join(' ');
}

/** The shared claude argv with the normal tool set and `--model`. */
export function spawnArgv({ debugFile, mcpConfig, model }: { debugFile: string; mcpConfig: string; model: string }) {
  return [...claudeArgv({ allowedTools: SPAWN_ALLOWED_TOOLS, debugFile, mcpConfig }), '--model', model];
}

/** Spawn sessions from `tmux list-panes -a -F '#{session_name}\t#{pane_id}\t#{pane_pid}'`, first pane each. */
export function parseFlock(listing: string) {
  const panes = new Map<string, FlockPane>();
  for (const line of listing.split('\n')) {
    const [session = '', pane = '', pid = ''] = line.split('\t');
    const row = SESSION.exec(session)?.[1];
    if (row && !panes.has(session)) panes.set(session, { pane, pid: Number(pid), row, session });
  }
  return [...panes.values()];
}
