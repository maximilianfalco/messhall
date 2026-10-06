import path from 'node:path';

import { SERVER_NAME } from '../../../src/mcp/constants.js';

import { claudeArgv } from './claudeTmux.js';
import { REPO_ROOT } from './paths.js';

export const SPAWN_SESSION_PREFIX = 'messhall-';
export const SEAT_SESSION_PREFIX = `${SPAWN_SESSION_PREFIX}seat-`;
export const AGENT_BRIEF = path.join(REPO_ROOT, 'tools/dev/briefs/agent.md');
export const ROLE_WAIT_MIN = 2;
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
const SEAT = new RegExp(`^${SEAT_SESSION_PREFIX}([a-z0-9-]{1,40})$`);

export interface QueueRow {
  branch: string;
  id: string;
  job: string;
  owner: string;
  status: string;
  waitsOn: string[];
}

interface Pane {
  pane: string;
  pid: number;
  session: string;
}

export type FlockPane = Pane & ({ kind: 'row'; row: string } | { kind: 'seat'; name: string });

export const sessionName = (id: string) => `${SPAWN_SESSION_PREFIX}${id}`;
export const seatSessionName = (name: string) => `${SEAT_SESSION_PREFIX}${name}`;
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

// Every seated agent joins, says hello and waits for the orchestrator or the human to give it a role.
function seatLines({ name, room, until = '' }: { name: string; room: string; until?: string }) {
  return [
    `Use the messhall tools for your seat, not a fifo or a script: join #${room} as ${name} now, post one line saying who you are, and keep the seat, never call leave${until}.`,
    `Then do nothing else until orchestrator or human posts "@${name} your role: ...", and check it with list_members (assign_role sets it there).`,
    `If no role comes in ${ROLE_WAIT_MIN} minutes, post "@orchestrator what is my role?" and wait again.`,
    `${AGENT_BRIEF} says what each role does.`,
  ];
}

/** The first prompt for a queue row, one line since a newline would send it early. The row is claimed before it is typed. */
export function spawnPrompt({
  branch,
  brief,
  id,
  reviewers,
  room,
  worktree,
}: {
  branch: string;
  brief?: string;
  id: string;
  reviewers: string[];
  room: string;
  worktree: string;
}) {
  const slug = branchSlug(branch);
  const start = brief
    ? `Read ${brief} first and follow it. Your job is row ${id} of the job queue, branch ${branch}.`
    : `Run /messhall-pickup-any-work ${id}, branch ${branch}.`;
  const first = reviewers[0];
  return [
    ...seatLines({ name: slug, room, until: ' until the row is closed' }),
    `Once your role is worker: ${start}`,
    `The row is already claimed for you and your worktree is ${worktree}, so skip the claim and worktree steps.`,
    `Post one short line in #${room} at each point: claimed, tests green, PR open (with the url), CI result, merged.`,
    `Review gate, which beats any merge step in the brief or skill: do not merge on green CI. Once CI is green post "ready for review: <PR url> @${first}" and call wait.`,
    `Fix each finding, push, post "round N: <PR url> @${first}" (N from 2) and wait again.`,
    `merge only after "approved @${slug} <PR url>" from ${reviewers.join(' or ')} or a human line that says go.`,
    `If a reviewer posts "@human stuck", stop and wait for the human. A PR that touches a CRITICAL.md tree still waits for the human.`,
    `When the channel rings you, or a human line or a mention of you lands, read it and answer in #${room} right away, then go back to work.`,
    `When the row is closed, post with done: true and the PR url.`,
  ].join(' ');
}

/** The first prompt for a seat with no queue row, one line. Its role, and so its work, comes later. */
export function seatPrompt({ name, room, rubric }: { name: string; room: string; rubric?: string }) {
  return [
    `You are a seated agent with no job yet.`,
    ...seatLines({ name, room }),
    ...(rubric ? [`when you review, also use the rubric in ${rubric}.`] : []),
    `Answer a ring, a human line or a mention of you right away.`,
  ].join(' ');
}

/** The shared claude argv with the normal tool set and `--model`. */
export function spawnArgv({ debugFile, mcpConfig, model }: { debugFile: string; mcpConfig: string; model: string }) {
  return [...claudeArgv({ allowedTools: SPAWN_ALLOWED_TOOLS, debugFile, mcpConfig }), '--model', model];
}

/** Spawn and seat sessions from `tmux list-panes -a -F '#{session_name}\t#{pane_id}\t#{pane_pid}'`, first pane each. */
export function parseFlock(listing: string) {
  const panes = listing.split('\n').flatMap((line): FlockPane[] => {
    const [session = '', pane = '', pid = ''] = line.split('\t');
    const base = { pane, pid: Number(pid), session };
    const name = SEAT.exec(session)?.[1];
    const row = SESSION.exec(session)?.[1];
    if (name) return [{ ...base, kind: 'seat', name }];
    return row ? [{ ...base, kind: 'row', row }] : [];
  });
  return panes.filter((entry, index) => panes.findIndex(other => other.session === entry.session) === index);
}
