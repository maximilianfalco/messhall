import { describe, expect, it } from 'vitest';

import { kindFromClient, roleFromFolder } from '../../src/mcp/tools/join.js';

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
    [undefined, 'other'],
  ])('reads %s as %s', (name, kind) => {
    expect(kindFromClient(name)).toBe(kind);
  });
});
