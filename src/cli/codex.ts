import type { LaunchDeps, LaunchOptions } from './launch.js';
import type { Command } from 'commander';

import { BRIEF_HELP, briefLine, DEFAULT_ROOM, launch, launchDeps, launchTarget } from './launch.js';

interface Seat {
  brief?: string | null;
  name: string;
  room: string;
}

/** The first prompt: learn the thread id, join with it, then follow the brief, or wait when there is none. */
export const codexPrompt = ({ brief, name, room }: Seat) =>
  `Run echo $CODEX_THREAD_ID. Then join #${room} as ${name} with the messhall tools, with thread_id set to that value. ${
    brief ? briefLine(brief) : 'Then wait for instructions from the room or the human.'
  }`;

/** Plain `codex` and the prompt. Any `-c`, `--enable`, `--disable`, `--search` or `--no-daemon` starts it embedded, where no doorbell reaches it. */
export const codexArgv = (seat: Seat) => ['codex', codexPrompt(seat)];

/** Starts a Codex TUI in the room on the shared daemon, in the foreground. */
export function runCodex(options: LaunchOptions, deps: LaunchDeps) {
  const { cwd, ...seat } = launchTarget(options, deps.cwd);
  return launch(
    { agent: 'codex', argv: codexArgv(seat), brief: seat.brief, cwd, print: options.print, prompt: codexPrompt(seat) },
    deps,
  );
}

/** Registers `codex`. */
export function registerCodex(program: Command) {
  program
    .command('codex')
    .description('Start Codex in a room, on the shared daemon so the doorbell reaches it.')
    .option('--room <room>', `room to join, ${DEFAULT_ROOM} by default`)
    .option('--as <name>', 'name in the room, the cwd folder by default')
    .option('--cwd <dir>', 'folder to start codex in')
    .option('--brief <file>', BRIEF_HELP)
    .option('--print', 'only print the command and the first prompt')
    .action(async (options: Omit<LaunchOptions, 'print'> & { print?: boolean }) => {
      process.exitCode = await runCodex({ ...options, print: Boolean(options.print) }, launchDeps());
    });
}
