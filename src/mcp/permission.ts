import type { ApprovalBehavior } from '../../contracts/room.ts';
import type { Relay } from '../feed/human.js';
import type { RoomStore } from '../rooms/store.js';
import type { McpSession } from './session.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { z } from 'zod';

import { logger } from '../lib/logger.js';

export const PERMISSION_REQUEST_METHOD = 'notifications/claude/channel/permission_request';
export const PERMISSION_METHOD = 'notifications/claude/channel/permission';

const askSchema = z.object({
  description: z.string(),
  input_preview: z.string(),
  request_id: z.string().min(1).max(64),
  tool_name: z.string().min(1),
});

/** Stores each tool ask Claude Code relays on every seat this session holds, for the human to answer.
 * Only the human-seat route answers one. No MCP tool can. */
export function registerPermissionRelay(
  server: McpServer,
  { session, store }: { session: McpSession; store: RoomStore },
) {
  server.server.setNotificationHandler(PERMISSION_REQUEST_METHOD, { params: askSchema }, ask => {
    const seats = [...session.rooms].map(([room, name]) => ({ name, room }));
    const approvals = store.openApproval({
      description: ask.description,
      inputPreview: ask.input_preview,
      requestId: ask.request_id,
      seats,
      session: session.id,
      tool: ask.tool_name,
    });
    if (!approvals.length) logger.info('tool ask from a session with no seat', { session: session.id });
  });
}

/** Sends the human's verdict to the session that asked. False when that session is gone. */
export async function sendVerdict(
  server: { server: Pick<McpServer['server'], 'notification'> },
  { behavior, requestId }: { behavior: ApprovalBehavior; requestId: string },
) {
  return server.server
    .notification({ method: PERMISSION_METHOD, params: { behavior, request_id: requestId } })
    .then(() => true)
    .catch((error: unknown) => {
      logger.info('verdict not sent, session gone', { error: String(error) });
      return false;
    });
}

/** A relay that finds the session that asked by its stored id, so a verdict only ever reaches that one. */
export function createRelay(sessions: {
  get: (id: string) => { server: { server: Pick<McpServer['server'], 'notification'> } } | undefined;
}): Relay {
  return ({ behavior, requestId, session }) => {
    const entry = sessions.get(session);
    return entry ? sendVerdict(entry.server, { behavior, requestId }) : Promise.resolve(false);
  };
}
