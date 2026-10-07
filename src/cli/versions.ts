import type { Runner } from '../lib/run.js';

import { z } from 'zod';

// Keys app/scripts/bundle.sh stamps into the built app. An app from before them has none.
const appPlistSchema = z.object({
  MesshallCommit: z.string().optional(),
  MesshallCommittedAt: z.string().optional(),
  MesshallFeedContract: z.number().int().optional(),
});

/** A commit stamp. Null when git was not there to ask. */
export type Build = { commit: string; committed_at: string } | null;

/** What one side runs. Undefined fields mean the side predates the stamp, so it is the old one. */
export interface Stamp {
  build: Build | undefined;
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
  const parsed = appPlistSchema.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) return undefined;
  const { MesshallCommit: commit, MesshallCommittedAt: committedAt, MesshallFeedContract: contract } = parsed.data;
  return { build: commit && committedAt ? { commit, committed_at: committedAt } : undefined, contract };
}
