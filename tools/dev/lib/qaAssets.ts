import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const QA_BRANCH = 'qa-assets';
export const GITHUB_REPO = 'maximilianfalco/messhall';

/** Runs git with the args. `env` adds to the environment, `input` goes to stdin. Returns trimmed stdout. */
export type Git = (args: string[], options?: { env?: Record<string, string>; input?: string }) => string;

/** Reads a pr number like `58`. Throws on anything else. */
export function parsePr(value: string) {
  const pr = Number(value);
  if (!/^\d+$/.test(value) || pr <= 0) throw new Error(`bad pr "${value}", pass the number like 58`);
  return pr;
}

/** Where a file lands on the qa branch: `pr-<n>/<base name>`. */
export const assetPath = (pr: number, file: string) => `pr-${pr}/${path.basename(file)}`;

/** Blob url with `?raw=true`, which GitHub sends on to the raw file. */
export function assetLink(asset: string) {
  const alt = path.basename(asset, path.extname(asset));
  return `![${alt}](https://github.com/${GITHUB_REPO}/blob/${QA_BRANCH}/${asset}?raw=true)`;
}

function fetchBranch(git: Git) {
  git(['fetch', 'origin', QA_BRANCH]);
  return git(['rev-parse', 'FETCH_HEAD']);
}

/**
 * Adds the files to the qa branch with git plumbing and a private index, so the caller's
 * branch, index and work tree never change. Plain push, never forced: the branch only grows.
 */
export function uploadQaAssets({ files, git, pr }: { files: string[]; git: Git; pr: number }) {
  const parent = git(['ls-remote', 'origin', `refs/heads/${QA_BRANCH}`]) ? fetchBranch(git) : undefined;
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-index-'));
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    git(parent ? ['read-tree', parent] : ['read-tree', '--empty'], { env });
    for (const file of files) {
      const blob = git(['hash-object', '-w', file]);
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${assetPath(pr, file)}`], { env });
    }
    const tree = git(['write-tree'], { env });
    const commit = git([
      'commit-tree',
      tree,
      ...(parent ? ['-p', parent] : []),
      '-m',
      `chore: add qa assets for pr ${pr}`,
    ]);
    git(['push', 'origin', `${commit}:refs/heads/${QA_BRANCH}`]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
  return files.map(file => assetLink(assetPath(pr, file)));
}
