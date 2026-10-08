import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { askHumanInputSchema } from '../../../contracts/mcp.ts';
import { QUESTION_TTL_MS } from '../../config.js';
import { askItems } from '../../rooms/questions.js';

import { notJoined, refuse, registerRoomTool, removedFrom, reply } from './registry.js';

/** Registers `ask_human`: posts the question as the caller's line and returns at once, never blocking. */
export function registerAskHuman(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'ask_human', { deps, description, inputSchema: askHumanInputSchema }, async input => {
    const { room } = input;
    const as = session.rooms.get(room);
    if (!as) return notJoined(room);
    const asked = store.askQuestion({ as, questions: askItems(input), room });
    if (asked.ok) {
      const { id, message_id } = asked.question;
      return reply(
        `asked the human in #${room} as #${message_id}, question id ${id}. keep working: the answer comes as a human line that mentions you, or a messhall line after ${QUESTION_TTL_MS / 60_000} minutes. asking again replaces this question.`,
      );
    }
    switch (asked.reason) {
      case 'muted':
        return refuse(`you are muted in #${room}, so you cannot ask the human. wait for the human to unmute you.`);
      case 'room_closed':
        return refuse(`#${room} is closed, every agent said done. ask the human to post or reopen it.`);
      default:
        return removedFrom(session, room);
    }
  });
}
