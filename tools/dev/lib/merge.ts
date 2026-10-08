import path from 'node:path';

export const VETO_LABEL = 'human veto';

/** Runs gh with the args and returns its stdout. Throws on a non-zero exit. */
export type Gh = (args: string[]) => string;

interface PrView {
  changedFiles: number;
  files: { path: string }[];
  headRefName: string;
  headRefOid: string;
  labels: { name: string }[];
}

/** The globs in the ```paths block of CRITICAL.md, the same list the labeler reads. */
export const criticalGlobs = (critical: string) =>
  (/```paths\n([\s\S]*?)```/.exec(critical)?.[1] ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

function readView(json: string) {
  try {
    return JSON.parse(json) as PrView;
  } catch {
    throw new Error(`gh pr view gave no json: ${json.slice(0, 200)}`);
  }
}

/** Squash merges a PR as admin and deletes its head branch, unless it has the veto label or touches a critical tree.
 * The file check catches a PR the labeler has not reached yet, and the merge is pinned to the head that was checked. */
export function mergePr({ critical, gh, pr }: { critical: string; gh: Gh; pr: number }) {
  const view = readView(gh(['pr', 'view', String(pr), '--json', 'changedFiles,files,headRefName,headRefOid,labels']));
  if (view.files.length < view.changedFiles) return { files: [], ok: false, reason: 'too_many_files' } as const;
  const globs = criticalGlobs(critical);
  const files = view.files.map(file => file.path).filter(file => globs.some(glob => path.matchesGlob(file, glob)));
  if (files.length || view.labels.some(label => label.name === VETO_LABEL)) {
    return { files, ok: false, reason: 'human_veto' } as const;
  }
  gh(['pr', 'merge', String(pr), '--squash', '--admin', '--match-head-commit', view.headRefOid]);
  try {
    gh(['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${view.headRefName}`]);
    return { deleted: true, ok: true } as const;
  } catch {
    return { deleted: false, ok: true } as const;
  }
}
