import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../../src/config.js';

const root = path.resolve(import.meta.dirname, '../..');
const LAUNCHER = path.join(root, 'app/scripts/messhall');
const onMac = process.platform === 'darwin';

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'messhall-launcher-')));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const fakeRuntime = () => {
  const runtime = path.join(dir, 'Messhall.app/Contents/Resources/runtime');
  mkdirSync(path.join(runtime, 'bin'), { recursive: true });
  writeFileSync(path.join(runtime, 'node'), '#!/bin/sh\necho "node $*"\n');
  chmodSync(path.join(runtime, 'node'), 0o755);
  copyFileSync(LAUNCHER, path.join(runtime, 'bin/messhall'));
  chmodSync(path.join(runtime, 'bin/messhall'), 0o755);
  return runtime;
};

describe.skipIf(!onMac)('the bundled messhall launcher', () => {
  it('runs the bundled node and cli when reached through a symlink, as brew links it', () => {
    const runtime = fakeRuntime();
    const link = path.join(dir, 'bin/messhall');
    mkdirSync(path.dirname(link));
    symlinkSync(path.join(runtime, 'bin/messhall'), link);

    const result = spawnSync(link, ['status', '--json'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      `node --disable-warning=ExperimentalWarning ${path.join(runtime, 'cli/dist/src/cli.js')} status --json`,
    );
  });
});

describe('dmg.sh', () => {
  it('puts the launcher in the runtime the cask links', () => {
    expect(readFileSync('app/scripts/dmg.sh', 'utf8')).toContain('cp app/scripts/messhall "$RUNTIME/bin/messhall"');
  });
});

describe('the version a release tag names', () => {
  it('matches across the package, the cli and the app', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const plist = readFileSync('app/Messhall/Resources/Info.plist', 'utf8');
    const app = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];

    expect(CLI_VERSION).toBe(pkg.version);
    expect(app).toBe(pkg.version);
  });
});
