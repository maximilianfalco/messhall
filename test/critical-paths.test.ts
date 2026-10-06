import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const critical = readFileSync(path.join(root, 'CRITICAL.md'), 'utf8');
const block = /```paths\n([\s\S]*?)```/.exec(critical);
const globs = (block?.[1] ?? '')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const tablePaths = Array.from(critical.matchAll(/^\| `([^`]+)`/gm), match => match[1]!)
  .flatMap(cell => cell.split('`, `'))
  .filter(cell => !cell.includes('*'));

const covered = (file: string) =>
  globs.some(glob => (glob.endsWith('/**') ? file.startsWith(glob.slice(0, -2)) : glob === file));

describe('critical paths list', () => {
  it('covers every path named in the CRITICAL.md table', () => {
    const missing = tablePaths.filter(file => !covered(file));
    expect(missing).toStrictEqual([]);
  });

  it('has a paths block that protects the doc, the workflow and the script', () => {
    expect(block).not.toBeNull();
    const meta = ['CRITICAL.md', '.github/workflows/critical-paths.yml', '.github/scripts/critical-paths.sh'];
    expect(globs.filter(glob => meta.includes(glob))).toStrictEqual(meta);
  });
});
