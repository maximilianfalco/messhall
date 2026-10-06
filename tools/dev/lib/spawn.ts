import path from 'node:path';

import { shellLine } from '../../../src/lib/shell.js';
import { SERVER_NAME } from '../../../src/mcp/constants.js';

import { claudeArgv } from './claudeTmux.js';

export const SPAWN_SESSION_PREFIX = 'messhall-';
export const SEAT_SESSION_PREFIX = `${SPAWN_SESSION_PREFIX}seat-`;
export const ROLE_WAIT_MIN = 2;
/** The reviewer `docs/briefs/worker.md` names, which `--reviewer` swaps out. */
export const DEFAULT_REVIEWER = 'reviewer-1';
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

/** The first prompt for every spawned agent, one line since a newline would send it early. It only seats the agent:
 * its work comes later, in the role instructions. */
export function seatPrompt({ name, room }: { name: string; room: string }) {
  return [
    `You are a seated agent with no role yet. Read the using-messhall skill first.`,
    `Use the messhall tools for your seat, not a fifo or a script: join #${room} as ${name} now, post one line saying who you are, and keep the seat, never call leave.`,
    `Talk in the room only through those tools, never through messhall post or messhall-dev agent, so the room shows you as claude.`,
    `Never speak as the human: no messhall say, no human key, no human-seat routes. To try a surface, test with your own name or a scratch daemon (pnpm messhall-dev daemon).`,
    `Then do nothing else until orchestrator or human gives you a role: after a line that mentions you, call my_role and follow the instructions it returns.`,
    `If my_role still says unassigned after one ${ROLE_WAIT_MIN * 60} s wait, post "@orchestrator what is my role?".`,
    `Whenever a role line mentions you later, call my_role again and switch to what it says.`,
    `When you have nothing to do, end your turn and let the doorbell ring you, do not loop on wait.`,
    `Answer a ring, a human line or a mention of you in #${room} right away, then go back to work.`,
  ].join(' ');
}

/** Role instructions for a queue row: the role text with `reviewer` in its review gate, then the row, branch and claimed worktree. */
export function rowInstructions({
  branch,
  brief,
  id,
  reviewer = DEFAULT_REVIEWER,
  role,
  worktree,
}: {
  branch: string;
  brief?: string;
  id: string;
  reviewer?: string;
  role?: string;
  worktree: string;
}) {
  const guide = brief ? `its brief is ${brief}` : `/messhall-pickup-any-work ${id} covers how to work it`;
  const row = [
    `Your work: row ${id} of the job queue, branch ${branch}.`,
    `It is already claimed and your worktree is ${worktree}, so skip the claim and worktree steps, and ${guide}.`,
    `Closing the row is yours: when it is finished, you may run queue.py done ${id} yourself. Keep your seat until then.`,
  ].join(' ');
  return role ? `${role.replaceAll(`@${DEFAULT_REVIEWER}`, `@${reviewer}`)}\n\n${row}` : row;
}

/** The orchestrator line that gives `member` its role with the instructions in `file`. */
export const assignLine = ({
  file,
  member,
  role,
  room,
}: {
  file: string;
  member: string;
  role: string;
  room: string;
}) =>
  shellLine([
    'pnpm',
    'messhall-dev',
    'agent',
    'orchestrator',
    '--room',
    room,
    '--say',
    `@${member} your role: ${role}`,
    '--assign',
    `${member}=${role}`,
    '--instructions',
    file,
  ]);

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
