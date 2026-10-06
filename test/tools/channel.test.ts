import { describe, expect, it } from 'vitest';

import { proofLines } from '../../tools/dev/commands/channel.js';

describe('proofLines', () => {
  it('keeps the messhall registration, bell and tool lines only', () => {
    const log = [
      '2026-10-06T00:16:41.105Z [DEBUG] MCP server "other": Channel notifications registered',
      '2026-10-06T00:16:41.160Z [DEBUG] MCP server "messhall": Channel notifications registered',
      '2026-10-06T00:16:42.000Z [DEBUG] unrelated',
      '2026-10-06T00:16:49.022Z [DEBUG] MCP server "messhall": notifications/claude/channel: messhall: 1 new in #checkout',
      '2026-10-06T00:16:50.000Z [DEBUG] MCP server "messhall": Calling MCP tool: read_since',
    ].join('\n');
    expect(proofLines(log)).toStrictEqual([
      '2026-10-06T00:16:41.160Z [DEBUG] MCP server "messhall": Channel notifications registered',
      '2026-10-06T00:16:49.022Z [DEBUG] MCP server "messhall": notifications/claude/channel: messhall: 1 new in #checkout',
      '2026-10-06T00:16:50.000Z [DEBUG] MCP server "messhall": Calling MCP tool: read_since',
    ]);
  });
});
