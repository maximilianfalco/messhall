import type { RunResult } from '../lib/run.js';

import { setTimeout as sleep } from 'node:timers/promises';

import { findBin } from '../config.js';
import { runCommand } from '../lib/run.js';

export const SUBMIT_TRIES = 5;
const POLL_MS = 500;
const SETTLE_MS = 300;
// Codex's update dialog runs brew upgrade on Enter, so its safe option is the plain Skip.
const DIALOG_TARGETS = [
  /I am using this for local development/i,
  /Yes, I trust this folder/i,
  /Yes, proceed/i,
  /\d\. Trust and continue/,
  /\d\. Skip\s*$/,
];
const LOGIN = /Select login method|Please run \/login|Invalid API key|OAuth error/i;
const SELECTED = '❯';
const CODEX_SELECTED = '›';
const RULE = /^─{20,}$/;
// oxlint-disable-next-line no-control-regex
const DIM_RUN = /\x1b\[2m.*?(\x1b\[0m|$)/gm;
// oxlint-disable-next-line no-control-regex
const STYLE = /\x1b\[[\d;]*m/g;

export type Tmux = (args: string[]) => Promise<RunResult>;
type Dialog = { keys: string[]; kind: 'answer' } | { kind: 'login' } | { kind: 'none' };

/** Runs tmux from where it is installed, since launchd gives the daemon a bare PATH. */
export const tmux: Tmux = args => runCommand(findBin('tmux'), args);

/** What to press on the pane: arrows from the `❯` line to the safe option of a known dialog, or stop on a login screen. */
export function dialogKeys(pane: string): Dialog {
  if (LOGIN.test(pane)) return { kind: 'login' };
  const lines = pane.split('\n');
  const target = lines.findLastIndex(line => DIALOG_TARGETS.some(pattern => pattern.test(line)));
  const current = lines.findIndex(line => [SELECTED, CODEX_SELECTED].some(mark => line.trimStart().startsWith(mark)));
  if (target < 0 || current < 0) return { kind: 'none' };
  const moves = target - current;
  return {
    keys: [...Array.from({ length: Math.abs(moves) }, () => (moves > 0 ? 'Down' : 'Up')), 'Enter'],
    kind: 'answer',
  };
}

/** Polls `check` until it gives a value or `deadline` passes. */
export async function until<T>(
  deadline: number,
  check: () => Promise<T | undefined> | T | undefined,
  pollMs = POLL_MS,
): Promise<T | undefined> {
  const value = await check();
  if (value !== undefined || Date.now() > deadline) return value;
  await sleep(pollMs);
  return until(deadline, check, pollMs);
}

/** The text left in Claude Code's input box, the lines between the last two rules. Empty when no box shows.
 * Takes a pane captured with `-e`: the dim placeholder of an empty box is dropped, not read as text. */
export function inputText(screen: string) {
  const lines = screen.replace(DIM_RUN, '').replace(STYLE, '').split('\n');
  const bottom = lines.findLastIndex(line => RULE.test(line.trim()));
  const top = lines.slice(0, bottom).findLastIndex(line => RULE.test(line.trim()));
  if (top < 0) return '';
  return lines
    .slice(top + 1, bottom)
    .map(line => line.trim())
    .join(' ')
    .replace(SELECTED, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Types `text`, then sends a lone Enter until the input box is empty, at most 5 times.
 * Text and Enter in one burst read as a paste, so the Enter turns into a newline and the prompt sits unsent. */
export async function typePrompt(
  session: string,
  text: string,
  { run: send = tmux, settleMs = SETTLE_MS }: { run?: Tmux; settleMs?: number } = {},
): Promise<'sent' | 'stuck'> {
  await send(['send-keys', '-t', session, '-l', text]);
  const submit = async (triesLeft: number): Promise<'sent' | 'stuck'> => {
    if (!triesLeft) return 'stuck';
    await sleep(settleMs);
    await send(['send-keys', '-t', session, 'Enter']);
    await sleep(settleMs);
    const left = inputText((await send(['capture-pane', '-p', '-e', '-t', session])).stdout);
    return left ? submit(triesLeft - 1) : 'sent';
  };
  return submit(SUBMIT_TRIES);
}

/** The error line for a prompt that is still in the input box after every Enter. */
export const stuckLine = (session: string) =>
  `the prompt is stuck in the input box of tmux session ${session} after ${SUBMIT_TRIES} enters`;
