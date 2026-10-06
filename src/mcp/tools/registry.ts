import type { CodexClient } from '../../codex/client.js';
import type { RoomStore } from '../../rooms/store.js';
import type { ToolName } from '../constants.js';
import type { McpSession, SessionRegistry } from '../session.js';
import type { CallToolResult, McpServer, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server';

import { logger } from '../../lib/logger.js';
import { TOOL_ANNOTATIONS, TOOL_TITLES } from '../constants.js';

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

/** Registers one tool with its title and annotations. A throw becomes an isError reply, so a tool never throws. */
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
      deps.session.seen();
      try {
        return await handler(input, ctx);
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
