import { describe, expect, it } from 'vitest';

import { kindFromClient, ringsByChannel, roleFromFolder } from '../../src/mcp/tools/join.js';

describe('roleFromFolder', () => {
  it.each([
    ['trail', 'trail'],
    ['Payments_API', 'payments-api'],
    ['--web app--', 'web-app'],
    ['x'.repeat(50), 'x'.repeat(40)],
    ['日本', undefined],
  ])('turns %s into %s', (folder, role) => {
    expect(roleFromFolder(folder)).toBe(role);
  });
});

describe('kindFromClient', () => {
  it.each([
    ['claude-code', 'claude'],
    ['codex-mcp-client', 'codex'],
    ['cursor', 'other'],
    ['crush', 'other'],
    [undefined, 'other'],
  ])('reads %s as %s', (name, kind) => {
    expect(kindFromClient(name)).toBe(kind);
  });
});

describe('ringsByChannel', () => {
  it.each([
    ['claude-code', 'claude', true],
    ['crush', 'other', true],
    ['Crush', 'other', true],
    ['crush (via mcp-remote 0.14.3)', 'other', true],
    ['crushed', 'other', false],
    ['gemini-cli', 'claude', true],
    ['gemini-cli', 'other', false],
    ['codex-mcp-client', 'codex', false],
    [undefined, 'other', false],
  ] as const)('reads %s with kind %s as %s', (client, kind, channel) => {
    expect(ringsByChannel({ client, kind })).toBe(channel);
  });
});
