import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

import pc from 'picocolors';

import { ORCHESTRATOR_ROLE } from '../../contracts/room.ts';
import { codexConfigPath, daemonUrl } from '../config.js';
import { packageRoot } from '../lib/packageRoot.js';
import { runCommand } from '../lib/run.js';
import { shellLine } from '../lib/shell.js';

import { readClaudeEntry, readCodexEntry } from './mcp.js';
import { probeHealth } from './status.js';

export const DEFAULT_ROOM = 'lobby';
export const BRIEF_HELP =
  'instructions to read and follow after the join, docs/briefs/orchestrator.md for --as orchestrator';

export interface LaunchDeps {
  codexConfig: string;
  cwd: string;
  fetch: Parameters<typeof probeHealth>[0]['fetch'];
  log: (line: string) => void;
  run: typeof runCommand;
  spawn: (argv: string[], cwd: string) => Promise<number>;
  url: string;
}

export interface LaunchOptions {
  as?: string;
  brief?: string;
  cwd?: string;
  print: boolean;
  room?: string;
}

export const briefLine = (brief: string) => `Then read the brief at ${brief} and follow it in the room.`;

function briefPath(brief: string | undefined, name: string, base: string) {
  if (brief) return path.resolve(base, brief);
  if (name === ORCHESTRATOR_ROLE) return path.join(packageRoot(), 'docs', 'briefs', 'orchestrator.md');
  return null;
}

/** The seat an agent starts in: folder, room, name and brief. The name is the folder's name unless `as` is given.
 * The brief is a full path from `base`, and the orchestrator name gets the shipped orchestrator brief when none is given. */
export function launchTarget(options: LaunchOptions, base: string) {
  const cwd = path.resolve(base, options.cwd ?? '.');
  const name = options.as ?? path.basename(cwd);
  return { brief: briefPath(options.brief, name, base), cwd, name, room: options.room ?? DEFAULT_ROOM };
}

async function missingEntry(agent: 'claude' | 'codex', deps: LaunchDeps) {
  if (agent === 'claude') {
    return (await readClaudeEntry(deps.run)) ? null : 'claude code has no messhall entry. run messhall mcp install';
  }
  return readCodexEntry(deps.codexConfig) === null
    ? `codex has no messhall entry in ${deps.codexConfig}. run messhall mcp install`
    : null;
}

/** Prints the command and the first prompt, then runs it and returns its exit code.
 * Refuses with one line when the brief is not a file, the daemon is down or the agent has no messhall entry. `print` skips the last two. */
export async function launch(
  {
    agent,
    argv,
    brief,
    cwd,
    print,
    prompt,
  }: { agent: 'claude' | 'codex'; argv: string[]; brief: string | null; cwd: string; print: boolean; prompt: string },
  deps: LaunchDeps,
) {
  if (brief && !statSync(brief, { throwIfNoEntry: false })?.isFile()) {
    deps.log(pc.red(`no brief file at ${brief}`));
    return 1;
  }
  if (!print) {
    const probe = await probeHealth({ fetch: deps.fetch, url: deps.url });
    if (probe.state !== 'up') {
      deps.log(pc.red(`messhall is not running on ${deps.url}. run messhall start`));
      return 1;
    }
    const missing = await missingEntry(agent, deps);
    if (missing) {
      deps.log(pc.red(missing));
      return 1;
    }
  }
  deps.log(`cd ${shellLine([cwd])} && ${shellLine(argv)}`);
  deps.log(pc.dim(`first prompt: ${prompt}`));
  return print ? 0 : deps.spawn(argv, cwd);
}

/** Runs `argv` in the foreground on this terminal and resolves with its exit code. */
function runForeground(argv: string[], cwd: string) {
  return new Promise<number>(resolve => {
    // The agent owns the terminal, so ctrl-c is for it, not for us.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const finish = (code: number) => {
      process.off('SIGINT', ignore);
      resolve(code);
    };
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: 'inherit' });
    child.on('error', error => {
      console.error(pc.red(`could not start ${argv[0]}: ${error.message}`));
      finish(127);
    });
    child.on('exit', code => finish(code ?? 1));
  });
}

export const launchDeps = (): LaunchDeps => ({
  codexConfig: codexConfigPath(),
  cwd: process.cwd(),
  fetch,
  log: line => console.log(line),
  run: runCommand,
  spawn: runForeground,
  url: daemonUrl(),
});
