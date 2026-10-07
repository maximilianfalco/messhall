import type { ToolName } from './constants.js';
import type { ToolDeps } from './tools/registry.js';

import { McpServer } from '@modelcontextprotocol/server';

import { CLI_VERSION } from '../config.js';

import { INSTRUCTIONS, PROTOCOL_VERSIONS, SERVER_NAME, TOOL_DESCRIPTIONS, TOOL_NAMES } from './constants.js';
import { registerPermissionRelay } from './permission.js';
import { registerAgreements, registerConfirm, registerPropose, registerReject } from './tools/agreements.js';
import { registerAskHuman } from './tools/askHuman.js';
import { registerAssignRole } from './tools/assignRole.js';
import { registerDoorbellOk } from './tools/doorbellOk.js';
import { registerJoin } from './tools/join.js';
import { registerKick } from './tools/kick.js';
import { registerLeave } from './tools/leave.js';
import { registerListMembers } from './tools/listMembers.js';
import { registerListRooms } from './tools/listRooms.js';
import { registerMute } from './tools/mute.js';
import { registerMyRole } from './tools/myRole.js';
import { registerPost } from './tools/post.js';
import { registerReadSince } from './tools/readSince.js';
import { registerSetStatus } from './tools/setStatus.js';
import { registerSetTopic } from './tools/setTopic.js';
import { registerWait } from './tools/wait.js';

const TOOLS: Record<ToolName, (server: McpServer, deps: ToolDeps, description: string) => void> = {
  agreements: registerAgreements,
  ask_human: registerAskHuman,
  confirm: registerConfirm,
  doorbell_ok: registerDoorbellOk,
  assign_role: registerAssignRole,
  join: registerJoin,
  kick: registerKick,
  leave: registerLeave,
  list_members: registerListMembers,
  list_rooms: registerListRooms,
  mute: registerMute,
  my_role: registerMyRole,
  post: registerPost,
  propose: registerPropose,
  read_since: registerReadSince,
  reject: registerReject,
  set_status: registerSetStatus,
  set_topic: registerSetTopic,
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
      // The permission key is safe to declare because only the human key can answer an ask.
      capabilities: {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: { listChanged: false },
      },
      instructions: INSTRUCTIONS,
      supportedProtocolVersions: PROTOCOL_VERSIONS,
    },
  );
  TOOL_NAMES.forEach(name => TOOLS[name](server, deps, TOOL_DESCRIPTIONS[name]));
  registerPermissionRelay(server, deps);
  return server;
}
