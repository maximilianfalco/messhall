import type { LaunchDeps, LaunchOptions } from './launch.js';
import type { Command } from 'commander';

import { randomUUID } from 'node:crypto';

import { SEAT_ENV, SERVER_NAME } from '../mcp/constants.js';

import { BRIEF_HELP, briefLine, DEFAULT_ROOM, launch, launchDeps, launchTarget } from './launch.js';

interface Seat {
  brief?: string | null;
  name: string;
  room: string;
}

/** The first prompt: join the room under the name, then follow the brief, or wait when there is none. */
export const claudePrompt = ({ brief, name, room }: Seat) =>
  brief
    ? `Join #${room} as ${name} with the messhall tools. ${briefLine(brief)}`
    : `Join #${room} as ${name} with the messhall tools, then wait for instructions from the room or the human.`;

/** The `claude` argv with messhall as a dev channel. The prompt goes after `--` so a list flag in `extra` cannot eat it. */
export function claudeArgv({ extra, ...seat }: Seat & { extra: string[] }) {
  return [
    'claude',
    '--dangerously-load-development-channels',
    `server:${SERVER_NAME}`,
    ...extra,
    '--',
    claudePrompt(seat),
  ];
}

/** Starts Claude Code in the room with the doorbell on, in the foreground. A fresh seat key per run lets
 * the daemon hand this session its seat back after a reconnect or a restart. */
export function runClaude(options: LaunchOptions & { extra: string[] }, deps: LaunchDeps) {
  const { cwd, ...seat } = launchTarget(options, deps.cwd);
  const argv = claudeArgv({ ...seat, extra: options.extra });
  return launch(
    {
      agent: 'claude',
      argv,
      brief: seat.brief,
      cwd,
      env: { [SEAT_ENV]: randomUUID() },
      print: options.print,
      prompt: claudePrompt(seat),
    },
    deps,
  );
}

/** Registers `claude`. */
export function registerClaude(program: Command) {
  program
    .command('claude')
    .description('Start Claude Code in a room, with the messhall doorbell on.')
    .argument('[claudeArgs...]', 'more claude args, after --')
    .option('--room <room>', `room to join, ${DEFAULT_ROOM} by default`)
    .option('--as <name>', 'name in the room, the cwd folder by default')
    .option('--cwd <dir>', 'folder to start claude in')
    .option('--brief <file>', BRIEF_HELP)
    .option('--print', 'only print the command and the first prompt')
    .action(async (extra: string[], options: Omit<LaunchOptions, 'print'> & { print?: boolean }) => {
      process.exitCode = await runClaude({ ...options, extra, print: Boolean(options.print) }, launchDeps());
    });
}
