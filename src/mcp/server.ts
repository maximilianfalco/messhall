import type { ToolName } from './constants.js';
import type { ToolDeps } from './tools/registry.js';

import { McpServer } from '@modelcontextprotocol/server';

import { CLI_VERSION } from '../config.js';

import { INSTRUCTIONS, PROTOCOL_VERSIONS, SERVER_NAME, TOOL_DESCRIPTIONS, TOOL_NAMES } from './constants.js';
import { registerAssignRole } from './tools/assignRole.js';
import { registerJoin } from './tools/join.js';
import { registerLeave } from './tools/leave.js';
import { registerListMembers } from './tools/listMembers.js';
import { registerListRooms } from './tools/listRooms.js';
import { registerPost } from './tools/post.js';
import { registerReadSince } from './tools/readSince.js';
import { registerWait } from './tools/wait.js';

const TOOLS: Record<ToolName, (server: McpServer, deps: ToolDeps, description: string) => void> = {
  assign_role: registerAssignRole,
  join: registerJoin,
  leave: registerLeave,
  list_members: registerListMembers,
  list_rooms: registerListRooms,
  post: registerPost,
  read_since: registerReadSince,
  wait: registerWait,
};

/**
 * One MCP server for one session. It speaks 2025-11-25, 2025-06-18 and 2025-03-26, never 2026-07-28: there
 * Claude Code stops treating it as a channel. Claude Code checks the channel capability at register time.
 */
export function createMesshallServer(deps: ToolDeps) {
  const server = new McpServer(
    { name: SERVER_NAME, version: CLI_VERSION },
    {
      capabilities: { experimental: { 'claude/channel': {} }, tools: { listChanged: false } },
      instructions: INSTRUCTIONS,
      supportedProtocolVersions: PROTOCOL_VERSIONS,
    },
  );
  TOOL_NAMES.forEach(name => TOOLS[name](server, deps, TOOL_DESCRIPTIONS[name]));
  return server;
}
