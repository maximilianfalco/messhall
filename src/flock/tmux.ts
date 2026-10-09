import type { RunResult } from '../lib/run.js';

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { findBin } from '../config.js';
import { runCommand } from '../lib/run.js';

export const SUBMIT_TRIES = 5;
const POLL_MS = 500;
// Claude Code can keep text as a draft when Enter lands right behind it, so Enter waits this long.
const SETTLE_MS = 500;
const TITLE_WAIT_MS = 5_000;
const TYPED_MAX = 200;
// Claude Code starts its pane title with ✳ when idle and a braille spinner while working.
const CLAUDE_TITLE = /^[✳\u2800-\u28ff]/u;
// Codex's update dialog runs brew upgrade on Enter, so its safe option is the plain Skip.
// Trusting a folder lets its hooks and .mcp.json run, so these answers stay apart from the rest.
// Older claude builds said "Yes, proceed" on the trust prompt.
const TRUST_TARGETS = [/Yes, I trust this folder/i, /Yes, proceed/i, /\d\. Trust and continue/];
const DIALOG_TARGETS = [/I am using this for local development/i, /\d\. Skip\s*$/, ...TRUST_TARGETS];
const LOGIN = /Select login method|Please run \/login|Invalid API key|OAuth error/i;
const SELECTED = '❯';
const CODEX_SELECTED = '›';
const RULE = /^─{20,}$/;
// Claude Code starts an answer with ⏺ and echoes a sent prompt after > or ❯.
const TURN_START = /^\s*(⏺|>|❯ \S)/;
// A line Claude Code draws on its own: a turn start, a tool result or a bare error.
const MARKED = /^\s*(⏺|>|❯ \S|⎿|API Error)/;
const ERROR_LINE = /^\s*(?:⎿\s*)?(API Error\b.*)$/;
// A numbered pick or a dialog footer: typed keys there would choose an option, not reach the input box.
const MENU = /^\s*❯\s*\d+\.|Enter to confirm|Esc to cancel/m;
// oxlint-disable-next-line no-control-regex
const DIM_RUN = /\x1b\[2m.*?(\x1b\[0m|$)/gm;
// oxlint-disable-next-line no-control-regex
const STYLE = /\x1b\[[\d;]*m/g;
// oxlint-disable-next-line no-control-regex
const ESC = /\x1b/g;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

export type Tmux = (args: string[]) => Promise<RunResult>;
type Dialog = { keys: string[]; kind: 'answer' | 'trust' } | { kind: 'login' } | { kind: 'none' };

/** Runs tmux from where it is installed, since launchd gives the daemon a bare PATH.
 * `-u` keeps output utf-8: launchd sets no locale, and tmux would print the ✳ of a claude title as `_`. */
export const tmux: Tmux = args => runCommand(findBin('tmux'), ['-u', ...args]);

/** What to press on the pane: arrows from the `❯` line to the safe option of a known dialog, or stop on a login screen.
 * A folder trust prompt is kind `trust`, so a caller can refuse to trust. */
export function dialogKeys(pane: string): Dialog {
  if (LOGIN.test(pane)) return { kind: 'login' };
  const lines = pane.split('\n');
  const target = lines.findLastIndex(line => DIALOG_TARGETS.some(pattern => pattern.test(line)));
  const current = lines.findIndex(line => [SELECTED, CODEX_SELECTED].some(mark => line.trimStart().startsWith(mark)));
  if (target < 0 || current < 0) return { kind: 'none' };
  const moves = target - current;
  return {
    keys: [...Array.from({ length: Math.abs(moves) }, () => (moves > 0 ? 'Down' : 'Up')), 'Enter'],
    kind: TRUST_TARGETS.some(pattern => pattern.test(lines[target]!)) ? 'trust' : 'answer',
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

/** The API error that ended the agent's last turn: the last line Claude Code drew above the input box starts with it,
 * so a message that only mentions one does not count. The tail is that whole last turn, from its `⏺` or `>` line,
 * so a new error after a carry on line reads as a new tail. */
export function apiError(pane: string) {
  const lines = pane.replace(STYLE, '').split('\n');
  const bottom = lines.findLastIndex(line => RULE.test(line.trim()));
  const top = lines.slice(0, bottom).findLastIndex(line => RULE.test(line.trim()));
  if (top < 0) return;
  const above = lines.slice(0, top);
  const last = above.findLastIndex(line => MARKED.test(line));
  const reason = ERROR_LINE.exec(above[last] ?? '')?.[1]?.trim();
  if (!reason) return;
  const start = Math.max(
    0,
    above.slice(0, last).findLastIndex(line => TURN_START.test(line)),
  );
  const turn = above.slice(start);
  const tail = turn
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  return { reason, tail };
}

/** True once the pane title shows Claude Code idle or working, polled up to `waitMs`. A shell or anything else is not ready. */
async function claudeReady(session: string, run: Tmux, waitMs: number) {
  const ready = await until(Date.now() + waitMs, async () => {
    const title = (await run(['display-message', '-p', '-t', session, '#{pane_title}'])).stdout;
    return CLAUDE_TITLE.test(title) || undefined;
  });
  return ready === true;
}

/** Puts `text` in the input box with ESC bytes stripped. A short single line is typed. Anything longer or with a
 * newline goes in as one bracketed paste, since a typed newline would send the first part on its own. */
async function enterText(session: string, text: string, run: Tmux) {
  const clean = text.replace(ESC, '');
  if (clean.length <= TYPED_MAX && !CONTROL.test(clean)) {
    await run(['send-keys', '-t', session, '-l', clean]);
    return;
  }
  const buffer = `messhall-${randomUUID()}`;
  await run(['set-buffer', '-b', buffer, '--', clean]);
  await run(['paste-buffer', '-p', '-d', '-b', buffer, '-t', session]);
}

/** Puts `text` in the input box, then sends a lone Enter until the box is empty, at most 5 times. Types nothing
 * and presses nothing unless the pane title shows Claude Code idle or working.
 * Text and Enter in one burst read as a paste, so the Enter turns into a newline and the prompt sits unsent. */
export async function typePrompt(
  session: string,
  text: string,
  {
    run: send = tmux,
    settleMs = SETTLE_MS,
    titleWaitMs = TITLE_WAIT_MS,
  }: { run?: Tmux; settleMs?: number; titleWaitMs?: number } = {},
): Promise<'not_ready' | 'sent' | 'stuck'> {
  if (!(await claudeReady(session, send, titleWaitMs))) return 'not_ready';
  await enterText(session, text, send);
  const submit = async (triesLeft: number): Promise<'not_ready' | 'sent' | 'stuck'> => {
    if (!triesLeft) return 'stuck';
    await sleep(settleMs);
    if (!(await claudeReady(session, send, titleWaitMs))) return 'not_ready';
    await send(['send-keys', '-t', session, 'Enter']);
    await sleep(settleMs);
    const left = inputText((await send(['capture-pane', '-p', '-e', '-t', session])).stdout);
    return left ? submit(triesLeft - 1) : 'sent';
  };
  return submit(SUBMIT_TRIES);
}

/** The error line for a prompt that did not go out: a pane that never showed Claude Code, or a prompt still in the box. */
export const untypedLine = (session: string, outcome: 'not_ready' | 'stuck') =>
  outcome === 'not_ready'
    ? `tmux session ${session} never showed claude idle or working in its title, nothing typed`
    : `the prompt is stuck in the input box of tmux session ${session} after ${SUBMIT_TRIES} enters`;

/** True when the pane shows a menu or a dialog, so nothing gets typed into it. */
export const menuOpen = (pane: string) => MENU.test(pane.replace(STYLE, ''));

/** Types `text` into an agent's pane only when nothing else is there. A menu would take the keys as a pick,
 * and a draft in the input box would go out with the text. */
export async function typeIfClear(
  session: string,
  text: string,
  options: { run?: Tmux; settleMs?: number; titleWaitMs?: number } = {},
): Promise<'draft' | 'menu' | 'not_ready' | 'sent' | 'stuck'> {
  const { run = tmux } = options;
  const screen = (await run(['capture-pane', '-p', '-e', '-t', session])).stdout;
  if (menuOpen(screen)) return 'menu';
  if (inputText(screen)) return 'draft';
  return typePrompt(session, text, options);
}
