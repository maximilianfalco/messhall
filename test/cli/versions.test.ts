import { describe, expect, it } from 'vitest';

import { appStamp, olderSide, versionWarnings } from '../../src/cli/versions.js';

const OLD = { commit: 'a'.repeat(40), committed_at: '2026-10-07T01:00:00Z' };
const NEW = { commit: 'b'.repeat(40), committed_at: '2026-10-07T08:00:00Z' };

describe('olderSide', () => {
  it('calls the side with the lower contract older, whatever the commits say', () => {
    expect(olderSide({ a: { build: NEW, contract: 4 }, b: { build: OLD, contract: 5 } })).toBe('a');
    expect(olderSide({ a: { build: OLD, contract: 6 }, b: { build: NEW, contract: 5 } })).toBe('b');
  });

  it('calls a side with no contract older', () => {
    expect(olderSide({ a: { build: undefined, contract: undefined }, b: { build: NEW, contract: 5 } })).toBe('a');
    expect(olderSide({ a: { build: NEW, contract: 5 }, b: { build: undefined, contract: undefined } })).toBe('b');
  });

  it('calls a side with no build key older when contracts match', () => {
    expect(olderSide({ a: { build: undefined, contract: 5 }, b: { build: NEW, contract: 5 } })).toBe('a');
  });

  it('compares commit times when contracts match', () => {
    expect(olderSide({ a: { build: OLD, contract: 5 }, b: { build: NEW, contract: 5 } })).toBe('a');
    expect(olderSide({ a: { build: NEW, contract: 5 }, b: { build: OLD, contract: 5 } })).toBe('b');
  });

  it('says same for the same commit', () => {
    expect(olderSide({ a: { build: NEW, contract: 5 }, b: { build: { ...NEW }, contract: 5 } })).toBe('same');
  });

  it('says unknown when either build is null', () => {
    expect(olderSide({ a: { build: null, contract: 5 }, b: { build: NEW, contract: 5 } })).toBe('unknown');
    expect(olderSide({ a: { build: NEW, contract: 5 }, b: { build: null, contract: 5 } })).toBe('unknown');
  });

  it('says unknown for two commits made at the same time', () => {
    const twin = { ...NEW, commit: 'c'.repeat(40) };

    expect(olderSide({ a: { build: NEW, contract: 5 }, b: { build: twin, contract: 5 } })).toBe('unknown');
  });
});

describe('versionWarnings', () => {
  const current = { build: NEW, contract: 5 };

  it('stays quiet when the daemon, the install and the app match', () => {
    expect(versionWarnings({ app: current, daemon: current, installed: current })).toStrictEqual([]);
  });

  it('stays quiet about the app when none is built', () => {
    expect(versionWarnings({ app: undefined, daemon: current, installed: current })).toStrictEqual([]);
  });

  it('tells a stale daemon to restart', () => {
    expect(versionWarnings({ app: undefined, daemon: { build: OLD, contract: 5 }, installed: current })).toStrictEqual([
      'warning: the daemon runs older code than the installed messhall. run messhall start',
    ]);
  });

  it('tells a daemon from before build stamps to restart', () => {
    const ancient = { build: undefined, contract: undefined };

    expect(versionWarnings({ app: undefined, daemon: ancient, installed: current })).toStrictEqual([
      'warning: the daemon runs older code than the installed messhall. run messhall start',
    ]);
  });

  it('tells a daemon newer than the install to reinstall', () => {
    expect(versionWarnings({ app: undefined, daemon: current, installed: { build: OLD, contract: 5 } })).toStrictEqual([
      'warning: the daemon runs newer code than the installed messhall. run make install, then messhall start',
    ]);
  });

  it('tells an old app to rebuild', () => {
    expect(versionWarnings({ app: { build: OLD, contract: 4 }, daemon: current, installed: current })).toStrictEqual([
      'warning: the built app is older than the daemon. run make app',
    ]);
  });

  it('tells an app newer than the daemon to restart the daemon', () => {
    expect(
      versionWarnings({ app: { build: NEW, contract: 5 }, daemon: { build: OLD, contract: 5 }, installed: current }),
    ).toStrictEqual([
      'warning: the daemon runs older code than the installed messhall. run messhall start',
      'warning: the built app is newer than the daemon. run messhall start',
    ]);
  });
});

describe('appStamp', () => {
  const plist = (json: unknown) => () => Promise.resolve({ code: 0, stderr: '', stdout: JSON.stringify(json) });

  it('reads the contract and the commit the app was built from', async () => {
    const run = plist({ MesshallCommit: NEW.commit, MesshallCommittedAt: NEW.committed_at, MesshallFeedContract: 5 });

    await expect(appStamp({ plistPath: '/app/Info.plist', run })).resolves.toStrictEqual({ build: NEW, contract: 5 });
  });

  it('reads an app from before the stamps as having none', async () => {
    const run = plist({ CFBundleName: 'Messhall' });

    await expect(appStamp({ plistPath: '/app/Info.plist', run })).resolves.toStrictEqual({
      build: undefined,
      contract: undefined,
    });
  });

  it('reads an app built outside git as having an unknown build', async () => {
    const run = plist({ MesshallFeedContract: 5 });

    await expect(appStamp({ plistPath: '/app/Info.plist', run })).resolves.toStrictEqual({ build: null, contract: 5 });
  });

  it('says no app when plutil cannot read the plist', async () => {
    const run = () => Promise.resolve({ code: 1, stderr: 'no such file', stdout: '' });

    await expect(appStamp({ plistPath: '/app/Info.plist', run })).resolves.toBeUndefined();
  });
});
