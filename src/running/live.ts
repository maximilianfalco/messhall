import type { Running } from '../../contracts/feed.ts';
import type { CodexClient } from '../codex/client.js';
import type { Runner } from '../lib/run.js';
import type { KnownSeat } from './running.js';

import { runningAgents } from './running.js';
import { codexProcesses, cwdsFromLsof, gitPlace, readClaudeSessions, readCodexThreads } from './scan.js';
import { suggestRooms } from './suggest.js';

/** True when `pid` still runs. A process of another user still counts. */
export function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function plainCodex(run: Runner) {
  const pids = codexProcesses((await run('ps', ['-axo', 'pid=,comm=,args='])).stdout);
  if (pids.length === 0) return new Map<number, string>();
  return cwdsFromLsof((await run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')])).stdout);
}

/** Builds the scan behind the human's running list: every claude and codex session on this Mac, with the
 * rooms it may want. Reads session files, ps, lsof and git, never a transcript. */
export function createRunningScan({
  alive,
  claudeDir,
  codex,
  run,
  seats,
}: {
  alive: (pid: number) => boolean;
  claudeDir: string;
  codex: Pick<CodexClient, 'request'>;
  run: Runner;
  seats: () => Promise<KnownSeat[]>;
}) {
  return async (): Promise<Running> => {
    const [codexPids, codexThreads, known] = await Promise.all([plainCodex(run), readCodexThreads({ codex }), seats()]);
    const agents = await runningAgents({
      claude: readClaudeSessions({ alive, dir: claudeDir }),
      codexPids,
      codexThreads,
      place: cwd => gitPlace({ cwd, run }),
      seats: known,
    });
    return { agents, suggestions: suggestRooms({ agents }) };
  };
}
