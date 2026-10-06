import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { dialogKeys, inputText } from '../../src/flock/tmux.js';

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
