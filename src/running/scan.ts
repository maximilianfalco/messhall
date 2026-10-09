import type { Runner } from '../lib/run.js';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

// Claude Code writes one <pid>.json per live session. The <pid>.<hash>.key files beside them are never read.
const SESSION_FILE = /^\d+\.json$/;

const claudeSessionSchema = z.object({
  cwd: z.string().min(1),
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  status: z.string().optional(),
});

export interface ClaudeSession {
  cwd: string;
  id: string;
  pid: number;
  status: 'busy' | 'idle' | 'unknown';
}

function parseSession(text: string) {
  try {
    return claudeSessionSchema.safeParse(JSON.parse(text)).data ?? null;
  } catch {
    return null;
  }
}

const statusOf = (status: string | undefined) => (status === 'busy' || status === 'idle' ? status : 'unknown');

/** Lists the live Claude Code sessions in `dir`: folder, session id and idle or busy. A session whose pid
 * is gone is left out. Never reads a transcript. */
export function readClaudeSessions({ alive, dir }: { alive: (pid: number) => boolean; dir: string }) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(name => SESSION_FILE.test(name))
    .sort()
    .flatMap((name): ClaudeSession[] => {
      const found = parseSession(readFileSync(path.join(dir, name), 'utf8'));
      if (!found || !alive(found.pid)) return [];
      return [{ cwd: found.cwd, id: found.sessionId, pid: found.pid, status: statusOf(found.status) }];
    });
}

/** The repo a folder is in, named by its main checkout so a worktree counts as its repo, and the branch.
 * Both null outside a repo, and the branch null on a detached head. */
export async function gitPlace({ cwd, run }: { cwd: string; run: Runner }) {
  const out = await run('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--abbrev-ref', 'HEAD']);
  const [commonDir, branch] = out.stdout.trim().split('\n');
  if (out.code !== 0 || !commonDir) return { branch: null, repo: null };
  return { branch: branch && branch !== 'HEAD' ? branch : null, repo: path.basename(path.dirname(commonDir)) };
}
