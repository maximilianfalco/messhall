import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const SLOT = path.join(root, 'app/scripts/slot.sh');
const CLEAN = path.join(root, 'app/scripts/clean.sh');
const onMac = process.platform === 'darwin';

let dir: string;
let holders: ChildProcess[];

const isHeld = (lock: string) => spawnSync('lockf', ['-t', '0', lock, 'true']).status === 75;

const holdBothSlots = () => {
  holders = [1, 2].map(slot => spawn('lockf', [path.join(dir, `messhall-app-slot-${slot}.lock`), 'sleep', '30']));
  const deadline = Date.now() + 5000;
  while (![1, 2].every(slot => isHeld(path.join(dir, `messhall-app-slot-${slot}.lock`)))) {
    if (Date.now() > deadline) throw new Error('slots never held');
  }
};

const slot = (command: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', [SLOT, 'sh', '-c', command], {
    encoding: 'utf8',
    env: { ...process.env, MESSHALL_APP_SLOT: '', MESSHALL_APP_SLOT_DIR: dir, ...env },
    timeout: 4000,
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'messhall-app-scripts-'));
  holders = [];
});

afterEach(() => {
  holders.forEach(holder => holder.kill());
  rmSync(dir, { force: true, recursive: true });
});

describe.skipIf(!onMac)('slot.sh', () => {
  it('marks the command as inside a slot and passes its exit code through', () => {
    const result = slot('echo "in slot $MESSHALL_APP_SLOT"; exit 3');

    expect(result.status).toBe(3);
    expect(result.stdout).toBe('in slot 1\n');
  });

  it('runs a nested call at once instead of waiting for a second slot', () => {
    holdBothSlots();

    const result = slot('echo nested', { MESSHALL_APP_SLOT: '1' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('nested\n');
  });
});

describe('clean.sh', () => {
  it('refuses a folder that is not a git worktree and leaves it alone', () => {
    mkdirSync(path.join(dir, 'app', 'build'), { recursive: true });
    writeFileSync(path.join(dir, 'app', 'build', 'keep'), '');

    const result = spawnSync('bash', [CLEAN, dir], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a git worktree');
    expect(existsSync(path.join(dir, 'app', 'build', 'keep'))).toBe(true);
  });

  it('refuses the main checkout without FORCE', () => {
    mkdirSync(path.join(dir, '.git'));
    mkdirSync(path.join(dir, 'app', 'build'), { recursive: true });

    const result = spawnSync('bash', [CLEAN, dir], { encoding: 'utf8', env: { ...process.env, FORCE: '' } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is the main checkout');
    expect(existsSync(path.join(dir, 'app', 'build'))).toBe(true);
  });

  it('deletes a worktree build', () => {
    writeFileSync(path.join(dir, '.git'), 'gitdir: elsewhere\n');
    mkdirSync(path.join(dir, 'app', 'build', 'Messhall.app'), { recursive: true });

    const result = spawnSync('bash', [CLEAN, dir], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, 'app', 'build'))).toBe(false);
  });
});
