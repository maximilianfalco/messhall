import { existsSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findBin } from '../../src/config.js';
import { dialogKeys, inputText, menuOpen, tmux, typeIfClear, typePrompt } from '../../src/flock/tmux.js';

const paneFixture = (name: string) => readFileSync(new URL(`fixtures/panes/${name}.txt`, import.meta.url), 'utf8');

const TRUST = ` Accessing workspace:
 /private/var/folders/xy/T/messhall-channel-cwd-abc
 Quick safety check: Is this a project you created or one you trust?
 Claude Code'll be able to read, edit, and execute files here.
 Security guide
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel`;

const CHANNELS = `WARNING: Loading development channels

 --dangerously-load-development-channels is for local channel development only.

 ❯ 1. Exit
   2. I am using this for local development

 Enter to confirm`;

describe('dialogKeys', () => {
  it('skips the codex update prompt instead of running the upgrade', () => {
    const pane = '  Update available\n› 1. Update now (runs brew upgrade)\n  2. Skip\n  3. Skip until next version';
    expect(dialogKeys(pane)).toStrictEqual({ keys: ['Down', 'Enter'], kind: 'answer' });
  });

  it('trusts the folder on the codex trust prompt', () => {
    const pane = '  Trust this folder?\n› 1. Trust and continue\n  2. Back to Agent Command Center';
    expect(dialogKeys(pane)).toStrictEqual({ keys: ['Enter'], kind: 'trust' });
  });

  it('leaves the codex composer alone', () => {
    expect(dialogKeys('› Ask Codex to do anything\n  GPT-6-Luna high')).toStrictEqual({ kind: 'none' });
  });

  it('moves down to trust on the folder trust prompt, marked as a trust answer', () => {
    expect(dialogKeys(TRUST)).toStrictEqual({ keys: ['Down', 'Enter'], kind: 'trust' });
  });

  it('marks the older yes proceed trust prompt as a trust answer', () => {
    expect(dialogKeys(' ❯ 1. Yes, proceed\n   2. No, exit')).toStrictEqual({ keys: ['Enter'], kind: 'trust' });
  });

  it('confirms a trust prompt already on the trust option', () => {
    expect(dialogKeys(' ❯ 1. Yes, I trust this folder\n   2. No, exit')).toStrictEqual({
      keys: ['Enter'],
      kind: 'trust',
    });
  });

  it('moves down to local development on the channels warning', () => {
    expect(dialogKeys(CHANNELS)).toStrictEqual({ keys: ['Down', 'Enter'], kind: 'answer' });
  });

  it('stops on a login screen', () => {
    expect(dialogKeys('Select login method:\n ❯ 1. Claude account with subscription')).toStrictEqual({ kind: 'login' });
  });

  it('does nothing on the normal prompt', () => {
    expect(dialogKeys('> \n  ? for shortcuts')).toStrictEqual({ kind: 'none' });
  });
});

describe('inputText', () => {
  it('is empty once the prompt was sent', () => {
    expect(inputText(paneFixture('empty'))).toBe('');
  });

  it('reads a one line prompt left in the box', () => {
    expect(inputText(paneFixture('stuck-one-line'))).toBe('merged it, close the row and clean up');
  });

  it('joins a wrapped prompt left in the box', () => {
    expect(inputText(paneFixture('stuck-wrapped'))).toBe(
      'the network dropped and your last request failed. carry on from where you stopped: check git status, finish the work, run the gate and open the PR',
    );
  });

  it('reads a prompt held as pasted text', () => {
    expect(inputText(paneFixture('stuck-paste'))).toBe('[Pasted text #1 +3 lines]');
  });

  it('skips the dim placeholder of an empty box', () => {
    expect(inputText(paneFixture('placeholder'))).toBe('');
  });

  it('reads a prompt from a pane captured with styles', () => {
    expect(inputText(paneFixture('stuck-styled'))).toBe('reply with the word ok');
  });

  it('is empty when no input box shows', () => {
    expect(inputText(paneFixture('dialog'))).toBe('');
  });
});

describe('menuOpen', () => {
  it('sees a numbered menu or a dialog footer, not an empty input box', () => {
    expect(menuOpen(' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend')).toBe(true);
    expect(menuOpen(' ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel')).toBe(true);
    expect(menuOpen(paneFixture('empty'))).toBe(false);
  });
});

const IDLE_TITLE = '✳ Messhall #dev seat\n';

const pane = (screen: string, title = IDLE_TITLE) => {
  const sent: string[][] = [];
  const run = (args: string[]) => {
    if (['send-keys', 'set-buffer', 'paste-buffer'].includes(args[0]!)) sent.push(args);
    if (args[0] === 'display-message') return Promise.resolve({ code: 0, stderr: '', stdout: title });
    const stdout = args[0] === 'capture-pane' && !sent.length ? screen : paneFixture('empty');
    return Promise.resolve({ code: 0, stderr: '', stdout });
  };
  return { run, sent };
};

describe('typePrompt', () => {
  it('types a short line and sends Enter on its own about 500 ms later', async () => {
    const at: number[] = [];
    const { run, sent } = pane(paneFixture('empty'));
    const timed = (args: string[]) => {
      if (args[0] === 'send-keys') at.push(Date.now());
      return run(args);
    };

    await expect(typePrompt('=s:', 'you have 2 new in #dev, call read_since', { run: timed })).resolves.toBe('sent');
    expect(sent).toStrictEqual([
      ['send-keys', '-t', '=s:', '-l', 'you have 2 new in #dev, call read_since'],
      ['send-keys', '-t', '=s:', 'Enter'],
    ]);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(450);
  });

  it('pastes a long prompt as one bracketed paste, so no part of it goes out early', async () => {
    const text = 'call my_role now. '.repeat(20).trim();
    const { run, sent } = pane(paneFixture('empty'));

    await expect(typePrompt('=s:', text, { run, settleMs: 0 })).resolves.toBe('sent');
    const [set, paste, enter] = sent;
    expect(set?.slice(0, 2)).toStrictEqual(['set-buffer', '-b']);
    expect(set?.slice(3)).toStrictEqual(['--', text]);
    expect(paste).toStrictEqual(['paste-buffer', '-p', '-d', '-b', set?.[2], '-t', '=s:']);
    expect(enter).toStrictEqual(['send-keys', '-t', '=s:', 'Enter']);
  });

  it('pastes a prompt with a newline instead of typing it, since a typed newline would submit half', async () => {
    const { run, sent } = pane(paneFixture('empty'));

    await typePrompt('=s:', 'first line\nsecond line', { run, settleMs: 0 });

    expect(sent[0]?.[0]).toBe('set-buffer');
    expect(sent[0]?.at(-1)).toBe('first line\nsecond line');
  });

  it('strips escape bytes, so the text cannot end the paste or send terminal codes', async () => {
    const { run, sent } = pane(paneFixture('empty'));

    await typePrompt('=s:', 'hi\x1b[201~ there\nnext', { run, settleMs: 0 });
    await typePrompt('=s:', 'short\x1b[2J line', { run, settleMs: 0 });

    expect(sent[0]?.at(-1)).toBe('hi[201~ there\nnext');
    expect(sent.find(args => args.includes('-l'))?.at(-1)).toBe('short[2J line');
  });

  it('types into a pane whose title shows claude working', async () => {
    const { run } = pane(paneFixture('empty'), '⠐ Messhall #dev seat\n');

    await expect(typePrompt('=s:', 'wake up', { run, settleMs: 0 })).resolves.toBe('sent');
  });

  it('types nothing into a pane whose title is not claude idle or working', async () => {
    const { run, sent } = pane(paneFixture('empty'), 'Mac\n');

    await expect(typePrompt('=s:', 'wake up', { run, settleMs: 0, titleWaitMs: 0 })).resolves.toBe('not_ready');
    expect(sent).toStrictEqual([]);
  });
});

describe('typeIfClear', () => {
  it('types and submits the text into an empty input box', async () => {
    const { run, sent } = pane(paneFixture('placeholder'));

    await expect(typeIfClear('=s:', 'wake up', { run, settleMs: 0 })).resolves.toBe('sent');
    expect(sent).toStrictEqual([
      ['send-keys', '-t', '=s:', '-l', 'wake up'],
      ['send-keys', '-t', '=s:', 'Enter'],
    ]);
  });

  it('types nothing into a pane that shows a menu, since a key there would pick an option', async () => {
    const { run, sent } = pane(' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel');

    await expect(typeIfClear('=s:', 'wake up', { run, settleMs: 0 })).resolves.toBe('menu');
    expect(sent).toStrictEqual([]);
  });

  it('types nothing over a draft, which would go out with the text', async () => {
    const { run, sent } = pane(paneFixture('stuck-one-line'));

    await expect(typeIfClear('=s:', 'wake up', { run, settleMs: 0 })).resolves.toBe('draft');
    expect(sent).toStrictEqual([]);
  });
});

describe.skipIf(!existsSync(findBin('tmux')))('tmux', () => {
  const socket = `messhall-test-${process.pid}`;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await tmux(['-L', socket, 'kill-server']);
  });

  it('reads the ✳ of an idle claude title when the daemon runs with no utf-8 locale, as under launchd', async () => {
    for (const name of ['LANG', 'LC_ALL', 'LC_CTYPE', 'TMUX']) vi.stubEnv(name, undefined);
    const title = '✳ Messhall #dev reviewer-1 seat';

    await tmux(['-L', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'idle', 'sleep 30']);
    await tmux(['-L', socket, 'select-pane', '-t', '=idle:', '-T', title]);

    const read = await tmux(['-L', socket, 'display-message', '-p', '-t', '=idle:', '#{pane_title}']);
    expect(read.stdout).toBe(`${title}\n`);
  });
});
