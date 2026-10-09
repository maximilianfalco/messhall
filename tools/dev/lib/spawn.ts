/** The reviewer `docs/briefs/worker.md` names, which `--reviewer` swaps out. */
export const DEFAULT_REVIEWER = 'reviewer-1';

const ROW_LINE =
  /^(?<id>\S+)\s+(?<status>\S+)\s+\[[^\]]*\](?: branch=`(?<branch>[^`]*)`)?(?: owner=(?<owner>.*?))?(?: waits on (?<waits>\S+(?:, \S+)*))? {2}(?<job>.*)$/;
export interface QueueRow {
  branch: string;
  id: string;
  job: string;
  owner: string;
  status: string;
  waitsOn: string[];
}

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
  return { ok: true, row, slug: branchSlug(row.branch) } as const;
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
