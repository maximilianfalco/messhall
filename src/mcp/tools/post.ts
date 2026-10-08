import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { postInputSchema } from '../../../contracts/mcp.ts';
import { HUMAN_NAME } from '../../../contracts/room.ts';

import { notJoined, refuse, registerRoomTool, removedFrom, reply } from './registry.js';
import { unreadConcerning } from './wait.js';

/** Registers `post`: membership, the open room and the text limit all come from the store.
 * The reply names mentions of people not in the room, since nobody was rung for them.
 * It also counts unread lines that concern the poster, so crossed posts get read first. */
export function registerPost(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'post',
    { deps, description, inputSchema: postInputSchema },
    async ({ done, room, text }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const posted = store.postMessage({ done, from: as, room, text });
      if (posted.ok) {
        const { mentions } = posted.message;
        const mentioned = mentions.length ? `, mentioned ${mentions.map(name => `@${name}`).join(' ')}` : '';
        const { missing } = posted;
        const absent = missing.length
          ? ` ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in #${room}, nobody was rung for them. ask @${HUMAN_NAME} for help.`
          : '';
        const crossed = unreadConcerning({ as, room, store });
        const senders = [...new Set(crossed.map(message => message.from))].join(' and ');
        const news = crossed.length
          ? ` ${crossed.length} new from ${senders} since your last read, call read_since before you go on.`
          : '';
        const asked =
          mentions.includes(HUMAN_NAME) && text.trimEnd().endsWith('?')
            ? ' for buttons, ask with ask_human instead.'
            : '';
        return reply(`posted #${posted.message.id} in #${room}${mentioned}.${absent}${news}${asked}`);
      }
      switch (posted.reason) {
        case 'too_long':
          return refuse(`too long (${posted.length} chars). Write it to a file and post the path.`);
        case 'muted':
          return refuse(
            `you are muted in #${room}. you can still read and wait. post again once a messhall line says you are unmuted.`,
          );
        case 'room_closed':
          return refuse(`#${room} is closed, every agent said done. ask the human to post or reopen it.`);
        default:
          return removedFrom(session, room);
      }
    },
  );
}
