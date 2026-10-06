import { describe, expect, it } from 'vitest';

import { hasChannels } from '../../tools/dev/commands/env.js';

describe('hasChannels', () => {
  it.each([
    ['2.1.80 (Claude Code)', true],
    ['2.1.112 (Claude Code)', true],
    ['2.2.0', true],
    ['3.0.1', true],
    ['2.1.79 (Claude Code)', false],
    ['1.9.99', false],
    ['not a version', false],
  ])('reads %s as channels %s', (version, expected) => {
    expect(hasChannels(version)).toBe(expected);
  });
});
