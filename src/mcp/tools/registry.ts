import type { CodexClient } from '../../codex/client.js';
import type { RoomStore } from '../../rooms/store.js';
import type { ToolName } from '../constants.js';
import type { McpSession, SessionRegistry } from '../session.js';
import type { CallToolResult, McpServer, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server';

import { checkDoorbell } from '../../doorbell/ringers/channel.js';
import { logger } from '../../lib/logger.js';
import { DOORBELL_OFF, TOOL_ANNOTATIONS, TOOL_TITLES } from '../constants.js';
import { reattachSeats } from '../seats.js';

export interface ToolDeps {
  codex: Pick<CodexClient, 'request'>;
  now: () => Date;
  session: McpSession;
  sessions: Pick<SessionRegistry<{ session: McpSession }>, 'sessionsFor'>;
  store: RoomStore;
}

/** A text reply. Never structuredContent: Claude Code shows that to the model instead of the text. */
export const reply = (text: string): CallToolResult => ({ content: [{ text, type: 'text' }] });

/** A refusal that tells the model what to do next. */
export const refuse = (text: string): CallToolResult => ({ content: [{ text, type: 'text' }], isError: true });

export const notJoined = (room: string) => refuse(`you are not in #${room}. call join first.`);

/** A bound session whose seat the store no longer has was kicked, so it lets go of the room and says so. */
export function removedFrom(session: McpSession, room: string) {
  session.unbind(room);
  return refuse(`you were removed from #${room} by the human or an orchestrator. call join to come back.`);
}

// Says once, on the next reply, that the test ring got no answer, since nothing can ring the agent to tell it.
function withDoorbellNotice(session: McpSession, result: CallToolResult): CallToolResult {
  if (!session.tellDoorbellOff()) return result;
  return { ...result, content: [...result.content, { text: DOORBELL_OFF, type: 'text' }] };
}

/**
 * Registers one tool with its title and annotations. A throw becomes an isError reply, so a tool never throws.
 * After the call, a channel session that just took a seat gets its doorbell check ring.
 */
export function registerRoomTool<Input, Output>(
  server: McpServer,
  name: ToolName,
  {
    deps,
    description,
    inputSchema,
  }: { deps: ToolDeps; description: string; inputSchema: StandardSchemaWithJSON<Input, Output> },
  handler: (input: Output, ctx: ServerContext) => Promise<CallToolResult>,
) {
  server.registerTool(
    name,
    { annotations: TOOL_ANNOTATIONS[name], description, inputSchema, title: TOOL_TITLES[name] },
    async (input: Output, ctx: ServerContext) => {
      reattachSeats({ ...deps, server });
      deps.session.seen();
      try {
        const result = await handler(input, ctx);
        checkDoorbell({ server, session: deps.session });
        return withDoorbellNotice(deps.session, result);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        logger.error(failure, { message: 'mcp tool failed', session: deps.session.id, tool: name });
        return refuse(
          `messhall failed on ${name}: ${failure.message}. try again, and tell the human if it keeps failing.`,
        );
      }
    },
  );
}
