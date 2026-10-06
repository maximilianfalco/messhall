import { describe, expect, it } from 'vitest';

import { clientType } from '../../src/mcp/constants.js';
import { ringsByChannel, roleFromFolder } from '../../src/mcp/tools/join.js';

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

describe('clientType', () => {
  it.each([
    ['claude-code', 'claude', 'claude', true],
    ['Claude-Code', 'claude', 'claude', true],
    ['claude', 'claude', 'claude', true],
    ['codex', 'codex', 'codex', false],
    ['codex-mcp-client', 'codex', 'codex', false],
    ['opencode', 'other', 'opencode', false],
    ['gemini-cli', 'other', 'gemini', false],
    ['crush', 'other', 'crush', true],
    ['Crush', 'other', 'crush', true],
    ['crush (via mcp-remote 0.14.3)', 'other', 'crush', true],
    ['goose-cli', 'other', 'goose', false],
    ['pi', 'other', 'pi', false],
    ['oh-my-pi', 'other', 'oh-my-pi', false],
    ['omp', 'other', 'oh-my-pi', false],
    ['Kilo Code', 'other', 'kilo', false],
    ['Cline', 'other', 'cline', false],
    ['qwen-code', 'other', 'qwen', false],
    ['reasonix', 'other', 'deepseek', false],
    ['prime-agent', 'other', 'prime', false],
    ['openhands', 'other', 'openhands', false],
    ['interpreter', 'other', 'open-interpreter', false],
    ['messhall-cli', 'other', 'script', false],
    ['messhall-dev', 'other', 'script', false],
    ['messhall-dev-agent-api', 'other', 'script', false],
    ['messhall-post-ci', 'other', 'script', false],
  ] as const)('reads %s as kind %s, label %s, channel %s', (name, kind, label, channel) => {
    expect(clientType(name)).toStrictEqual({ channel, kind, label });
  });

  it.each([
    ['Cursor', 'Cursor'],
    ['crushed', 'crushed'],
    ['Zed Editor', 'Zed'],
  ])('falls back to kind other with the first word of %s as the label', (name, label) => {
    expect(clientType(name)).toStrictEqual({ channel: false, kind: 'other', label });
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
