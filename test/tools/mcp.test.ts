import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOL_NAMES } from '../../src/mcp/constants.js';
import { mcpReport } from '../../tools/dev/commands/mcp.js';

beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mcpReport', () => {
  it('lists the instructions and every tool with its annotations, fields and description length', async () => {
    const result = await mcpReport({});

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toMatch(/instructions\s+\d+\/1500 chars/);
    TOOL_NAMES.forEach(name => expect(text).toContain(name));
    expect(text).toMatch(
      /join \(writes, \d+\/1500 chars\): Join a room\n {2}as\?, invite\?, kind\?, room, thread_id\?/,
    );
    expect(text).toMatch(/wait \(read only, \d+\/1500 chars\): .+\n {2}room\?, timeout_s\?/);
  });

  it('calls one tool after joining as the given role and prints its text', async () => {
    const result = await mcpReport({ as: 'api', input: '{"text":"hello"}', room: 'demo', tool: 'post' });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toContain('isError: false');
    expect(text).toMatch(/posted #\d+ in #demo\./);
  });

  it('exits 1 when the tool answers isError', async () => {
    const result = await mcpReport({ input: '{"room":"demo","text":"hi"}', tool: 'post' });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(1);
    expect(text).toContain('isError: true');
    expect(text).toContain('call join first');
  });

  it('refuses an unknown tool', async () => {
    const result = await mcpReport({ tool: 'shout' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain('no tool shout');
  });
});
