import path from 'node:path';

import { SERVER_NAME } from '../../../src/mcp/constants.js';

import { claudeArgv } from './claudeTmux.js';

export const SPAWN_SESSION_PREFIX = 'messhall-';
export const SEAT_SESSION_PREFIX = `${SPAWN_SESSION_PREFIX}seat-`;
export const ROLE_WAIT_MIN = 2;
const PLAN_FILE = 'personal-dev-notes.md';
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

// Every seated agent joins, says hello and waits for a role. What a role means lives in its instructions, not here.
function seatLines({ name, room, until }: { name: string; room: string; until: string }) {
  return [
    `Read the using-messhall skill first.`,
    `Use the messhall tools for your seat, not a fifo or a script: join #${room} as ${name} now, post one line saying who you are, and keep the seat, never call leave${until}.`,
    `Talk in the room only through those tools, never through messhall post or messhall-dev agent, so the room shows you as claude.`,
    `Never speak as the human: no messhall say, no human key, no human-seat routes. To try a surface, test with your own name or a scratch daemon (pnpm messhall-dev daemon).`,
    `Then do nothing else until orchestrator or human gives you a role: after a line that mentions you, call my_role and follow the instructions it returns.`,
    `If my_role still says unassigned after ${ROLE_WAIT_MIN} minutes, post "@orchestrator what is my role?" and wait again.`,
    `Whenever a role line mentions you later, call my_role again and switch to what it says.`,
    `Answer a ring, a human line or a mention of you in #${room} right away, then go back to work.`,
  ];
}

/** The first prompt for a queue row, one line since a newline would send it early. The row is claimed before it is typed. */
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
  const guide = brief ? `its brief is ${brief}` : `/messhall-pickup-any-work ${id} covers how to work it`;
  return [
    ...seatLines({ name: branchSlug(branch), room, until: ' until your work is finished' }),
    `Context for your role: you were spawned for row ${id} of the job queue, branch ${branch}.`,
    `It is already claimed and your worktree is ${worktree}, so skip the claim and worktree steps, and ${guide}.`,
    `Closing the row is yours: when it is finished, you may run queue.py done ${id} yourself.`,
  ].join(' ');
}

/** The first prompt for a seat with no queue row, one line. Its role, and so its work, comes later. */
export function seatPrompt({ name, room }: { name: string; room: string }) {
  return [`You are a seated agent with no job yet.`, ...seatLines({ name, room, until: '' })].join(' ');
}

/** The shared claude argv with the normal tool set and `--model`. It may also read the main checkout's plan without a prompt. */
export function spawnArgv({
  debugFile,
  mainCheckout,
  mcpConfig,
  model,
}: {
  debugFile: string;
  mainCheckout: string;
  mcpConfig: string;
  model: string;
}) {
  // A read rule on one file, not --add-dir, since Edit and Write would then reach the whole main checkout.
  const allowedTools = [...SPAWN_ALLOWED_TOOLS, `Read(/${path.join(mainCheckout, PLAN_FILE)})`];
  return [...claudeArgv({ allowedTools, debugFile, mcpConfig }), '--model', model];
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
