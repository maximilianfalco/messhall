import type { Build } from '../../contracts/health.ts';
import type { Runner } from '../lib/run.js';

import path from 'node:path';

import { z } from 'zod';

import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import { currentBuild } from '../daemon/build.js';
import { packageRoot } from '../lib/packageRoot.js';

// Keys app/scripts/bundle.sh stamps into the built app. An app from before them has none.
const appPlistSchema = z.object({
  MesshallCommit: z.string().optional(),
  MesshallCommittedAt: z.string().optional(),
  MesshallFeedContract: z.number().int().optional(),
});

/** What one side runs. A null build means git was not there to ask. Undefined means the side predates the stamp. */
export interface Stamp {
  build: Build | null | undefined;
  contract: number | undefined;
}

type Older = 'a' | 'b' | 'same' | 'unknown';

/** Which side runs older code: the contract decides first, then the commit time. */
export function olderSide({ a, b }: { a: Stamp; b: Stamp }): Older {
  if (a.contract === undefined && b.contract !== undefined) return 'a';
  if (b.contract === undefined && a.contract !== undefined) return 'b';
  if (a.contract !== undefined && b.contract !== undefined && a.contract !== b.contract) {
    return a.contract < b.contract ? 'a' : 'b';
  }
  if (a.build === undefined && b.build !== undefined) return 'a';
  if (b.build === undefined && a.build !== undefined) return 'b';
  if (!a.build || !b.build) return 'unknown';
  if (a.build.commit === b.build.commit) return 'same';
  const gap = Date.parse(a.build.committed_at) - Date.parse(b.build.committed_at);
  if (!gap) return 'unknown';
  return gap < 0 ? 'a' : 'b';
}

/** One line per side that runs the wrong code, with the command that fixes it. No app built means no app line. */
export function versionWarnings({
  app,
  daemon,
  installed,
}: {
  app: Stamp | undefined;
  daemon: Stamp;
  installed: Stamp;
}) {
  const lines: string[] = [];
  const daemonVsInstall = olderSide({ a: daemon, b: installed });
  if (daemonVsInstall === 'a') {
    lines.push('warning: the daemon runs older code than the installed messhall. run messhall start');
  }
  if (daemonVsInstall === 'b') {
    lines.push(
      'warning: the daemon runs newer code than the installed messhall. run make install, then messhall start',
    );
  }
  if (!app) return lines;
  const appVsDaemon = olderSide({ a: app, b: daemon });
  if (appVsDaemon === 'a') lines.push('warning: the built app is older than the daemon. run make app');
  if (appVsDaemon === 'b') lines.push('warning: the built app is newer than the daemon. run messhall start');
  return lines;
}

/** The stamp in a built app's Info.plist, or undefined when there is no app to read. */
export async function appStamp({ plistPath, run }: { plistPath: string; run: Runner }): Promise<Stamp | undefined> {
  const result = await run('plutil', ['-convert', 'json', '-o', '-', plistPath]);
  if (result.code !== 0) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
  const parsed = appPlistSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const { MesshallCommit: commit, MesshallCommittedAt: committedAt, MesshallFeedContract: contract } = parsed.data;
  if (contract === undefined) return { build: undefined, contract };
  // A stamped app built outside git has the contract but no commit, so its build is unknown, not old.
  return { build: commit && committedAt ? { commit, committed_at: committedAt } : null, contract };
}

/** What this checkout would run, and what its built app runs. A restarted daemon runs the former. */
export async function localStamps(run: Runner) {
  const plistPath = path.join(packageRoot(), 'app', 'build', 'Messhall.app', 'Contents', 'Info.plist');
  return {
    app: await appStamp({ plistPath, run }),
    installed: { build: currentBuild(), contract: FEED_CONTRACT_VERSION },
  };
}
