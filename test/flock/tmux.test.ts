import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { dialogKeys, inputText, menuOpen, typeIfClear } from '../../src/flock/tmux.js';

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
    expect(dialogKeys(pane)).toStrictEqual({ keys: ['Enter'], kind: 'answer' });
  });

  it('leaves the codex composer alone', () => {
    expect(dialogKeys('› Ask Codex to do anything\n  GPT-6-Luna high')).toStrictEqual({ kind: 'none' });
  });

  it('moves down to trust on the folder trust prompt', () => {
    expect(dialogKeys(TRUST)).toStrictEqual({ keys: ['Down', 'Enter'], kind: 'answer' });
  });

  it('confirms a prompt already on the safe option', () => {
    expect(dialogKeys(' ❯ 1. Yes, I trust this folder\n   2. No, exit')).toStrictEqual({
      keys: ['Enter'],
      kind: 'answer',
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

describe('typeIfClear', () => {
  const pane = (screen: string) => {
    const sent: string[][] = [];
    const run = (args: string[]) => {
      if (args[0] === 'send-keys') sent.push(args);
      const stdout = args[0] === 'capture-pane' && !sent.length ? screen : paneFixture('empty');
      return Promise.resolve({ code: 0, stderr: '', stdout });
    };
    return { run, sent };
  };

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
