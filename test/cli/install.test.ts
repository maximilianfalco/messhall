import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runInstall } from '../../src/cli/install.js';
import { runStart } from '../../src/cli/start.js';
import { runStop } from '../../src/cli/stop.js';
import { runUninstall } from '../../src/cli/uninstall.js';
import { launchAgentPlist, plistNodePath } from '../../src/lib/plist.js';

import { fakeLaunchctl } from './launchd.js';

const claudeEntry = (lines: string[]) => () =>
  Promise.resolve({
    code: 0,
    stderr: '',
    stdout: ['messhall:', '  URL: http://127.0.0.1:7787/mcp', ...lines].join('\n'),
  });
const SEATED = claudeEntry([`  X-Messhall-Seat: \${MESSHALL_SEAT:-}`]);

const FIXTURE = readFileSync(new URL('fixtures/dev.messhall.daemon.plist', import.meta.url), 'utf8');
const NODE = '/Users/someone/.nvm/versions/node/v22.21.0/bin/node';

let dir: string;
let plistPath: string;
let cliPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'messhall-install-'));
  plistPath = path.join(dir, 'LaunchAgents', 'dev.messhall.daemon.plist');
  cliPath = path.join(dir, 'cli.js');
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const install = (launchctl: ReturnType<typeof fakeLaunchctl>['launchctl'], print = false) =>
  runInstall({ cliPath, launchctl, logPath: path.join(dir, 'logs', 'daemon.log'), nodePath: NODE, plistPath, print });

describe('launchAgentPlist', () => {
  it('writes the LaunchAgent the lifecycle ticket asks for', () => {
    const plist = launchAgentPlist({
      cliPath: '/Users/someone/Code/messhall/dist/src/cli.js',
      logPath: '/Users/someone/Library/Logs/messhall/daemon.log',
      nodePath: NODE,
    });

    expect(plist).toBe(FIXTURE);
  });

  it('escapes paths that hold xml characters', () => {
    const plist = launchAgentPlist({ cliPath: '/a&b/<cli>.js', logPath: '/l.log', nodePath: NODE });

    expect(plist).toContain('<string>/a&amp;b/&lt;cli&gt;.js</string>');
  });

  it('reads the node path back out of a plist', () => {
    expect(plistNodePath(FIXTURE)).toBe(NODE);
  });
});

describe('runInstall', () => {
  it('refuses and runs nothing when the build is missing', async () => {
    const { calls, launchctl } = fakeLaunchctl({ plistPath });

    const result = await install(launchctl);

    expect(result.code).toBe(1);
    expect(result.report).toContain('pnpm build');
    expect(calls).toStrictEqual([]);
    expect(existsSync(plistPath)).toBe(false);
  });

  it('writes the plist, boots out any old copy and bootstraps the new one', async () => {
    writeFileSync(cliPath, '');
    const { calls, launchctl } = fakeLaunchctl({ codes: { bootout: 3 }, plistPath });

    const result = await install(launchctl);

    expect(result.code).toBe(0);
    expect(calls).toStrictEqual([
      'launchctl bootout gui/501/dev.messhall.daemon',
      `launchctl bootstrap gui/501 ${plistPath}`,
    ]);
    expect(plistNodePath(readFileSync(plistPath, 'utf8'))).toBe(NODE);
    expect(existsSync(path.join(dir, 'logs'))).toBe(true);
  });

  it('fails when bootstrap fails', async () => {
    writeFileSync(cliPath, '');
    const { launchctl } = fakeLaunchctl({ codes: { bootstrap: 5 }, plistPath });

    const result = await install(launchctl);

    expect(result.code).toBe(1);
    expect(result.report).toContain('launchctl said no');
  });

  it('only prints the plist and the commands with --print', async () => {
    writeFileSync(cliPath, '');
    const { calls, launchctl } = fakeLaunchctl({ plistPath });

    const result = await install(launchctl, true);

    expect(result.code).toBe(0);
    expect(calls).toStrictEqual([]);
    expect(existsSync(plistPath)).toBe(false);
    expect(result.report).toContain('<string>dev.messhall.daemon</string>');
    expect(result.report).toContain(`launchctl bootstrap gui/501 ${plistPath}`);
  });
});

describe('runStart', () => {
  it('tells you to install first when there is no plist', async () => {
    const { calls, launchctl } = fakeLaunchctl({ plistPath });

    const result = await runStart({ launchctl, plistPath, run: SEATED });

    expect(result.code).toBe(1);
    expect(result.report).toContain('messhall install');
    expect(calls).toStrictEqual([]);
  });

  it('bootstraps a stopped agent, then kickstarts it', async () => {
    writeFileSync(cliPath, '');
    await install(fakeLaunchctl({ plistPath }).launchctl);
    const { calls, launchctl } = fakeLaunchctl({ codes: { print: 113 }, plistPath });

    const result = await runStart({ launchctl, plistPath, run: SEATED });

    expect(result.code).toBe(0);
    expect(calls).toStrictEqual([
      'launchctl print gui/501/dev.messhall.daemon',
      `launchctl bootstrap gui/501 ${plistPath}`,
      'launchctl kickstart -k gui/501/dev.messhall.daemon',
    ]);
  });

  it('only kickstarts an agent that is already loaded', async () => {
    writeFileSync(cliPath, '');
    await install(fakeLaunchctl({ plistPath }).launchctl);
    const { calls, launchctl } = fakeLaunchctl({ plistPath });

    await runStart({ launchctl, plistPath, run: SEATED });

    expect(calls).toStrictEqual([
      'launchctl print gui/501/dev.messhall.daemon',
      'launchctl kickstart -k gui/501/dev.messhall.daemon',
    ]);
  });
});

describe('runStart with the claude entry', () => {
  beforeEach(async () => {
    writeFileSync(cliPath, '');
    await install(fakeLaunchctl({ plistPath }).launchctl);
  });

  it('warns when the claude entry has no seat header', async () => {
    const { launchctl } = fakeLaunchctl({ plistPath });

    const result = await runStart({ launchctl, plistPath, run: claudeEntry([]) });

    expect(result.code).toBe(0);
    expect(result.report).toContain('no seat header, so a seat is lost on a daemon restart. run messhall mcp install');
  });

  it('says an idle claude is not rung until its next call, and no more with the seat header', async () => {
    const { launchctl } = fakeLaunchctl({ plistPath });

    const result = await runStart({ launchctl, plistPath, run: SEATED });

    expect(result.report).toBe(
      [
        'messhall started. check it with messhall status',
        'an idle claude gets no ring until its next messhall call. restart between tasks, or nudge them',
      ].join('\n'),
    );
  });
});

describe('runStop', () => {
  it('boots the agent out', async () => {
    const { calls, launchctl } = fakeLaunchctl({ plistPath });

    const result = await runStop({ launchctl });

    expect(result.code).toBe(0);
    expect(calls).toStrictEqual(['launchctl bootout gui/501/dev.messhall.daemon']);
  });

  it('says so when it was not running', async () => {
    const { launchctl } = fakeLaunchctl({ codes: { bootout: 3 }, plistPath });

    const result = await runStop({ launchctl });

    expect(result).toStrictEqual({ code: 0, report: 'messhall was not running' });
  });
});

describe('runUninstall', () => {
  it('boots the agent out and removes the plist', async () => {
    writeFileSync(cliPath, '');
    await install(fakeLaunchctl({ plistPath }).launchctl);
    const { calls, launchctl } = fakeLaunchctl({ codes: { bootout: 3 }, plistPath });

    const result = await runUninstall({ launchctl, plistPath });

    expect(result.code).toBe(0);
    expect(calls).toStrictEqual(['launchctl bootout gui/501/dev.messhall.daemon']);
    expect(existsSync(plistPath)).toBe(false);
  });
});
