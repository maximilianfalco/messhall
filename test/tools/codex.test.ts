import { describe, expect, it } from 'vitest';

import { codexScreen, memberStatus } from '../../tools/dev/commands/codex.js';

const UPDATE = `  Update available · 0.157.1 → 0.160.1
  Release notes: https://github.com/openai/codex/releases/latest
› 1. Update now (runs \`brew upgrade --cask codex\`)
  2. Skip
  3. Skip until next version
  enter continue · esc skip`;

const TRUST = `  Folder access
  /tmp/somewhere
  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.
› 1. Trust and continue
  2. Back to Agent Command Center`;

const UPDATE_BOX = `╭─────────────────────────────────────────────────╮
│ ✨ Update available! 0.157.1 -> 0.160.1         │
╰─────────────────────────────────────────────────╯
› Ask Codex to do anything
  GPT-6-Luna high · ~ · ← for agents`;

const READY = `│ directory: ~                                  │
╰───────────────────────────────────────────────╯
› Ask Codex to do anything
  GPT-6-Luna high · ~ · ← for agents`;

const RESUME_FAILED = `  Resuming session…
› Error: Failed to resume session from /x.jsonl: thread/resume failed during TUI boots`;

describe('codexScreen', () => {
  it.each([
    ['update', UPDATE],
    ['trust', TRUST],
    ['ready', READY],
    ['ready', UPDATE_BOX],
    ['error', RESUME_FAILED],
    ['loading', '  Resuming session…'],
  ])('reads %s from the pane', (screen, pane) => {
    expect(codexScreen(pane)).toBe(screen);
  });
});

describe('memberStatus', () => {
  const LIST = [
    '#checkout, 3 members:',
    '- api (codex, idle), last seen 2026-01-01T10:00:00.000Z',
    '- web (codex (no doorbell), active, you), last seen 2026-01-01T10:00:05.000Z',
    '- human (human, idle), last seen 2026-01-01T10:00:00.000Z',
  ].join('\n');

  it('reads presence, last seen and the doorbell for a member', () => {
    expect(memberStatus({ list: LIST, name: 'api' })).toStrictEqual({
      doorbell: true,
      lastSeen: Date.parse('2026-01-01T10:00:00.000Z'),
      presence: 'idle',
    });
    expect(memberStatus({ list: LIST, name: 'web' })).toStrictEqual({
      doorbell: false,
      lastSeen: Date.parse('2026-01-01T10:00:05.000Z'),
      presence: 'active',
    });
  });

  it('gives undefined for a member not in the list', () => {
    expect(memberStatus({ list: LIST, name: 'ios' })).toBeUndefined();
  });
});
