import { describe, expect, it } from 'vitest';

import { appBuildsReport, LSREGISTER } from '../../tools/dev/commands/appBuilds.js';

const MAIN = '/code/messhall';
const MAIN_APP = `${MAIN}/app/build/Messhall.app`;
const WORKTREE = `${MAIN}/.worktrees/f9-picker`;
const WORKTREE_APP = `${WORKTREE}/app/build/Messhall.app`;

const block = ({ id, path }: { id: string; path: string }) =>
  [
    '--------------------------------------------------------------------------------',
    'bundle id:                  Messhall (0x5f9c)',
    `path:                       ${path} (0x79b8)`,
    'name:                       Messhall',
    `identifier:                 ${id}`,
    'executable:                 Contents/MacOS/Messhall',
  ].join('\n');

const dumpOf = (...apps: { id: string; path: string }[]) =>
  [
    block({ id: 'com.example.notes', path: '/Applications/Notes.app' }),
    ...apps.map(block),
    '--------------------------------------------------------------------------------',
  ].join('\n');

const running = (pid: number, app: string) => `${pid} ${app}/Contents/MacOS/Messhall`;

const report = ({
  dump = dumpOf({ id: 'dev.messhall.app', path: MAIN_APP }),
  exists = () => true,
  processes = '',
}: {
  dump?: string;
  exists?: (dir: string) => boolean;
  processes?: string;
}) => appBuildsReport({ dump, exists, mainApp: MAIN_APP, processes });

describe('appBuildsReport', () => {
  it('has no warnings when only the main checkout is registered and runs once', () => {
    expect(report({ processes: running(10, MAIN_APP) })).toStrictEqual([]);
  });

  it('names a worktree build registered under either id with the make line that cleans it', () => {
    const dump = dumpOf(
      { id: 'dev.messhall.app', path: MAIN_APP },
      { id: 'dev.messhall.app.worktree', path: WORKTREE_APP },
      { id: 'dev.messhall.app', path: `${MAIN}/.worktrees/f8-old/app/build/Messhall.app` },
    );

    expect(report({ dump })).toStrictEqual([
      `stray build ${WORKTREE_APP}, registered. clean it: make -C '${MAIN}' app-clean WORKTREE='${WORKTREE}'`,
      `stray build ${MAIN}/.worktrees/f8-old/app/build/Messhall.app, registered. clean it: make -C '${MAIN}' app-clean WORKTREE='${MAIN}/.worktrees/f8-old'`,
    ]);
  });

  it('unregisters by path when the checkout is gone', () => {
    const dump = dumpOf({ id: 'dev.messhall.app.worktree', path: WORKTREE_APP });

    expect(report({ dump, exists: () => false })).toStrictEqual([
      `stray build ${WORKTREE_APP}, registered. clean it: ${LSREGISTER} -u '${WORKTREE_APP}'`,
    ]);
  });

  it('quits a running stray build whose checkout is gone before it unregisters it', () => {
    const dump = dumpOf({ id: 'dev.messhall.app.worktree', path: WORKTREE_APP });

    expect(report({ dump, exists: () => false, processes: running(42, WORKTREE_APP) })).toStrictEqual([
      `stray build ${WORKTREE_APP}, registered, running as pid 42. clean it: pkill -f '${WORKTREE_APP}/Contents/MacOS/Messhall'; ${LSREGISTER} -u '${WORKTREE_APP}'`,
    ]);
  });

  it('names a running build that is not registered', () => {
    expect(report({ processes: [running(10, MAIN_APP), running(42, WORKTREE_APP)].join('\n') })).toStrictEqual([
      `stray build ${WORKTREE_APP}, running as pid 42. clean it: make -C '${MAIN}' app-clean WORKTREE='${WORKTREE}'`,
    ]);
  });

  it('names extra copies of the main app and keeps the first', () => {
    const processes = [running(10, MAIN_APP), running(11, MAIN_APP), running(12, MAIN_APP)].join('\n');

    expect(report({ processes })).toStrictEqual([
      '3 Messhall processes run from the main checkout. quit the extras: kill 11 12',
    ]);
  });

  it('ignores other apps named Messhall', () => {
    const dump = dumpOf({ id: 'dev.messhall.app', path: MAIN_APP }, { id: 'dev.messhall.apple', path: '/x/Other.app' });

    expect(report({ dump })).toStrictEqual([]);
  });
});
