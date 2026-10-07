import { existsSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths.js';
import { run } from '../lib/run.js';

export const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
export const APP_IDS = ['dev.messhall.app', 'dev.messhall.app.worktree'];
const BINARY = '/Contents/MacOS/Messhall';
const BUILD_SUFFIX = '/app/build/Messhall.app';

interface Stray {
  app: string;
  pids: number[];
  registered: boolean;
}

/** App paths `lsregister -dump` lists under a Messhall bundle id. */
export function registeredApps(dump: string) {
  return dump.split(/^-{10,}$/m).flatMap(entry => {
    const id = /^identifier:\s+(\S+)$/m.exec(entry)?.[1];
    const found = /^path:\s+(.+?)(?: \(0x[0-9a-f]+\))?$/m.exec(entry)?.[1];
    return id && found && APP_IDS.includes(id) ? [found] : [];
  });
}

/** Pid and app path for each `pgrep -lf` line running a Messhall app binary. */
export function runningApps(processes: string) {
  return processes.split('\n').flatMap(line => {
    const match = /^(\d+) (.+?\.app)\/Contents\/MacOS\/Messhall\b/.exec(line);
    return match?.[1] && match[2] ? [{ app: match[2], pid: Number(match[1]) }] : [];
  });
}

const checkoutOf = (app: string) => (app.endsWith(BUILD_SUFFIX) ? app.slice(0, -BUILD_SUFFIX.length) : '');

// The main checkout's make, since a worktree cut before app-clean has no such target.
const cleanLine = ({ exists, main, stray }: { exists: (dir: string) => boolean; main: string; stray: Stray }) => {
  const checkout = checkoutOf(stray.app);
  if (checkout && exists(checkout)) return `make -C '${main}' app-clean WORKTREE='${checkout}'`;
  const quit = stray.pids.length ? `pkill -f '${stray.app}${BINARY}'; ` : '';
  return `${quit}${LSREGISTER} -u '${stray.app}'`;
};

/** One warning per Messhall build outside the main checkout, and one for extra copies of the main app, each with the command that cleans it. */
export function appBuildsReport({
  dump,
  exists,
  mainApp,
  processes,
}: {
  dump: string;
  exists: (dir: string) => boolean;
  mainApp: string;
  processes: string;
}) {
  const running = runningApps(processes);
  const registered = registeredApps(dump);
  const apps = [...new Set([...registered, ...running.map(item => item.app)])].filter(app => app !== mainApp);
  const strays = apps.map(app => ({
    app,
    pids: running.filter(item => item.app === app).map(item => item.pid),
    registered: registered.includes(app),
  }));
  const lines = strays.map(stray => {
    const state = [
      ...(stray.registered ? ['registered'] : []),
      ...(stray.pids.length ? [`running as pid ${stray.pids.join(' ')}`] : []),
    ];
    return `stray build ${stray.app}, ${state.join(', ')}. clean it: ${cleanLine({ exists, main: checkoutOf(mainApp), stray })}`;
  });
  const main = running.filter(item => item.app === mainApp).map(item => item.pid);
  if (main.length < 2) return lines;
  return [
    ...lines,
    `${main.length} Messhall processes run from the main checkout. quit the extras: kill ${main.slice(1).join(' ')}`,
  ];
}

/** The check step: warns, never fails, so a stray build cannot block a commit. Skipped off macOS. */
export async function appBuildsStep({ mainCheckout }: { mainCheckout: string }) {
  const started = Date.now();
  if (process.platform !== 'darwin') return { code: 0, ms: 0, stderr: '', stdout: 'not macOS, skipped' };
  const [dump, processes] = await Promise.all([
    run(LSREGISTER, ['-dump'], REPO_ROOT),
    run('pgrep', ['-lf', `Messhall.app${BINARY}`], REPO_ROOT),
  ]);
  const warnings = appBuildsReport({
    dump: dump.stdout,
    exists: existsSync,
    mainApp: path.join(mainCheckout, 'app', 'build', 'Messhall.app'),
    processes: processes.stdout,
  });
  return { code: 0, ms: Date.now() - started, stderr: '', stdout: warnings.join('\n'), warn: warnings.length > 0 };
}
