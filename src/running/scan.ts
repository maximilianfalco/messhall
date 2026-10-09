import type { CodexClient, CodexResult } from '../codex/client.js';
import type { ThreadStatus } from '../codex/generated/v2/ThreadStatus.js';
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

// A session can end between the listing and the read, so a missing file is just no session.
function readSession(file: string) {
  try {
    return claudeSessionSchema.safeParse(JSON.parse(readFileSync(file, 'utf8'))).data ?? null;
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
      const found = readSession(path.join(dir, name));
      if (!found || !alive(found.pid)) return [];
      return [{ cwd: found.cwd, id: found.sessionId, pid: found.pid, status: statusOf(found.status) }];
    });
}

/** The repo a folder is in, named by its main checkout so a worktree counts as its repo, and the branch.
 * Both null outside a repo, and the branch null on a detached head. */
export async function gitPlace({ cwd, run }: { cwd: string; run: Runner }) {
  const out = await run('git', [
    '-C',
    cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
    '--abbrev-ref',
    'HEAD',
  ]);
  const [commonDir, branch] = out.stdout.trim().split('\n');
  if (out.code !== 0 || !commonDir) return { branch: null, repo: null };
  return { branch: branch && branch !== 'HEAD' ? branch : null, repo: path.basename(path.dirname(commonDir)) };
}

// Codex subcommands that are not a session a person types into.
const CODEX_NOT_A_SESSION = new Set(['app-server', 'mcp-server', 'exec', 'e', 'login', 'logout', 'mcp', 'completion']);

/** Pids of codex sessions in `ps -axo pid=,comm=,args=` output. Servers and one shot runs are left out. */
export function codexProcesses(ps: string) {
  return ps.split('\n').flatMap(line => {
    const [pid, comm, , sub] = line.trim().split(/\s+/);
    if (!pid || path.basename(comm ?? '') !== 'codex') return [];
    return sub && CODEX_NOT_A_SESSION.has(sub) ? [] : [Number(pid)];
  });
}

/** The folder of each pid in `lsof -a -d cwd -Fn -p <pids>` output. */
export function cwdsFromLsof(lsof: string) {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of lsof.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n') && pid !== null) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

export interface CodexThread {
  cwd: string;
  id: string;
  status: 'busy' | 'idle' | 'unknown';
}

const threadStatus = ({ type }: ThreadStatus) => (type === 'active' ? 'busy' : type === 'idle' ? 'idle' : 'unknown');

// Pages one at a time, since each page names the next.
async function loadedThreads({
  codex,
  cursor,
}: {
  codex: Pick<CodexClient, 'request'>;
  cursor: string | null;
}): Promise<string[] | null> {
  const page: CodexResult<'thread/loaded/list'> = await codex.request('thread/loaded/list', { cursor });
  if (!page.ok) return null;
  if (!page.result.nextCursor) return page.result.data;
  const rest = await loadedThreads({ codex, cursor: page.result.nextCursor });
  return rest && [...page.result.data, ...rest];
}

/** Lists the threads loaded on Codex's shared server with folder and idle or busy. Reads no turns.
 * Empty when the server is down. */
export async function readCodexThreads({ codex }: { codex: Pick<CodexClient, 'request'> }) {
  const ids = await loadedThreads({ codex, cursor: null });
  if (!ids) return [];
  const read = await Promise.all(ids.map(threadId => codex.request('thread/read', { includeTurns: false, threadId })));
  return read.flatMap((reply): CodexThread[] =>
    reply.ok
      ? [{ cwd: reply.result.thread.cwd, id: reply.result.thread.id, status: threadStatus(reply.result.thread.status) }]
      : [],
  );
}
