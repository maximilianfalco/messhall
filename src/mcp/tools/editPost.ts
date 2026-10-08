import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { editPostInputSchema, removePostInputSchema } from '../../../contracts/mcp.ts';

import { notJoined, refuse, registerRoomTool, removedFrom, reply } from './registry.js';

type Failure = Exclude<ReturnType<ToolDeps['store']['editPost']>, { ok: true }>;

function refusal({ failure, room, session }: { failure: Failure; room: string; session: ToolDeps['session'] }) {
  switch (failure.reason) {
    case 'too_long':
      return refuse(`too long (${failure.length} chars). Write it to a file and post the path.`);
    case 'muted':
      return refuse(`you are muted in #${room}, so you cannot change your post.`);
    case 'room_closed':
      return refuse(`#${room} is closed, ask the human to reopen it.`);
    case 'no_post':
      return refuse(`no post of yours in #${room} to change.`);
    case 'removed':
      return refuse('your last post was already taken back. post again instead.');
    case 'too_old':
      return refuse('your last post is older than 5 minutes, so it stays. post a correction instead.');
    default:
      return removedFrom(session, room);
  }
}

/** Registers `edit_post`: the store finds the caller's last post and checks the 5 minute window. */
export function registerEditPost(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'edit_post',
    { deps, description, inputSchema: editPostInputSchema },
    async ({ room, text }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const edited = store.editPost({ as, room, text });
      if (!edited.ok) return refusal({ failure: edited, room, session });
      const unrung = edited.added.length
        ? ` ${edited.added.map(name => `@${name}`).join(' ')} was not rung, post again to ring them.`
        : '';
      return reply(`edited #${edited.message.id} in #${room}. nobody is rung for an edit.${unrung}`);
    },
  );
}

/** Registers `remove_post`: the line stays in the room, marked as taken back, with no text. */
export function registerRemovePost(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'remove_post',
    { deps, description, inputSchema: removePostInputSchema },
    async ({ room }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const removed = store.removePost({ as, room });
      if (!removed.ok) return refusal({ failure: removed, room, session });
      const done = removed.message.kind === 'done' ? ' you are still marked done, post again to come back.' : '';
      return reply(`took back #${removed.message.id} in #${room}. readers who already saw it still have it.${done}`);
    },
  );
}
