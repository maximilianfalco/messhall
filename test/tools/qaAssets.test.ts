import { describe, expect, it } from 'vitest';

import { assetLink, assetPath, parsePr, uploadQaAssets } from '../../tools/dev/lib/qaAssets.js';

const fakeGit = (remoteHead: string) => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    const [command] = args;
    if (command === 'ls-remote') return remoteHead ? `${remoteHead}\trefs/heads/qa-assets` : '';
    if (command === 'rev-parse') return remoteHead;
    if (command === 'hash-object') return `blob-${calls.length}`;
    if (command === 'write-tree') return 'tree-1';
    if (command === 'commit-tree') return 'commit-1';
    return '';
  };
  return { calls, git };
};

describe('assetPath', () => {
  it('puts the file under pr-<n>/ by its base name', () => {
    expect(assetPath(3, '/tmp/out/dev-cli-check.gif')).toBe('pr-3/dev-cli-check.gif');
  });
});

describe('assetLink', () => {
  it('is a markdown image through the blob raw url, alt is the name without extension', () => {
    expect(assetLink('pr-3/dev-cli-check.gif')).toBe(
      '![dev-cli-check](https://github.com/maximilianfalco/messhall/blob/qa-assets/pr-3/dev-cli-check.gif?raw=true)',
    );
  });
});

describe('parsePr', () => {
  it('takes a positive whole pr number', () => {
    expect(parsePr('58')).toBe(58);
  });

  it('refuses anything else', () => {
    expect(() => parsePr('#58')).toThrow('pr');
    expect(() => parsePr('0')).toThrow('pr');
  });
});

describe('uploadQaAssets', () => {
  it('prints one markdown image per file', () => {
    const { git } = fakeGit('parent-1');

    const links = uploadQaAssets({ files: ['/tmp/a.gif', '/tmp/b.png'], git, pr: 3 });

    expect(links).toStrictEqual([
      '![a](https://github.com/maximilianfalco/messhall/blob/qa-assets/pr-3/a.gif?raw=true)',
      '![b](https://github.com/maximilianfalco/messhall/blob/qa-assets/pr-3/b.png?raw=true)',
    ]);
  });

  it('commits on top of the remote branch and pushes without force', () => {
    const { calls, git } = fakeGit('parent-1');

    uploadQaAssets({ files: ['/tmp/a.gif'], git, pr: 3 });

    expect(calls).toContainEqual(['commit-tree', 'tree-1', '-p', 'parent-1', '-m', 'chore: add qa assets for pr 3']);
    expect(calls.at(-1)).toStrictEqual(['push', 'origin', 'commit-1:refs/heads/qa-assets']);
    expect(calls.flat()).not.toContain('--force');
  });

  it('starts from an empty tree when the branch does not exist yet', () => {
    const { calls, git } = fakeGit('');

    uploadQaAssets({ files: ['/tmp/a.gif'], git, pr: 3 });

    expect(calls).toContainEqual(['read-tree', '--empty']);
    expect(calls).toContainEqual(['commit-tree', 'tree-1', '-m', 'chore: add qa assets for pr 3']);
  });
});
