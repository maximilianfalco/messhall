import type { McpServer } from '@modelcontextprotocol/server';

import { z } from 'zod';

import { joinInputSchema } from '../../contracts/mcp.ts';

export const JOIN_PROMPT = {
  description: 'Join a messhall room by name. The name defaults to the folder name.',
  name: 'join',
  title: 'Join a room',
} as const;

// room comes first: a slash command takes its arguments by position.
const joinArgs = z.object({ room: joinInputSchema.shape.room, as: joinInputSchema.shape.as });

/** The steps the agent follows after the slash command. */
function joinText({ as, room }: { as?: string; room: string }) {
  const name = as ? `and as "${as}"` : 'and no as, so the folder name is used';
  return [
    `Join messhall room #${room}.`,
    `1. Call join with room "${room}" ${name}.`,
    '2. If the reply says doorbell: checking, call wait once with timeout_s 40. A test ring wakes it: answer it with doorbell_ok, using the id it carries.',
    '3. If a reply says doorbell: off, tell the human in one line: this chat cannot be rung. Start it with messhall claude so mentions reach it.',
    '4. Post one line saying who you are. Keep the seat. Never call leave.',
  ].join('\n');
}

/** Registers the `join` prompt, the slash command that joins a room by name. */
export function registerJoinPrompt(server: McpServer) {
  const { description, title } = JOIN_PROMPT;
  server.registerPrompt(JOIN_PROMPT.name, { argsSchema: joinArgs, description, title }, ({ as, room }) => ({
    messages: [{ content: { text: joinText({ as, room }), type: 'text' }, role: 'user' }],
  }));
}
