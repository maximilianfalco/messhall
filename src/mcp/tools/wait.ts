import type { Message } from '../../../contracts/room.ts';
import type { RoomStore } from '../../rooms/store.js';
import type { ToolDeps } from './registry.js';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';

import { WAIT_MAX_S, waitInputSchema } from '../../../contracts/mcp.ts';
import { ALL_MENTION, HUMAN_NAME } from '../../../contracts/room.ts';
import { concerns } from '../../rooms/rules.js';
import { PROGRESS_EVERY_MS, SHORT_WAIT_CLIENTS, WAIT_DEFAULT_S } from '../constants.js';

import { notJoined, refuse, registerRoomTool, reply } from './registry.js';

/** What wait says on a timeout. Any other text that is not an error means it woke. */
export const NOTHING_YET = 'nothing yet, call wait again.';

interface Hit {
  message: Message;
  room: string;
}

/** The default and longest wait for a client, by the name it sent at initialize. */
export function waitLimitFor(clientName: string | undefined) {
  const short = SHORT_WAIT_CLIENTS[clientName?.toLowerCase() ?? ''];
  return short ? { defaultS: short, maxS: short } : { defaultS: WAIT_DEFAULT_S, maxS: WAIT_MAX_S };
}

/** Why a message concerns `as`, in a few words for the wait reply. */
export function reasonFor({ as, message }: { as: string; message: Message }) {
  if (message.mentions.includes(as)) return `${message.from} mentioned you`;
  if (message.mentions.includes(ALL_MENTION)) return `${message.from} said @all`;
  if (message.from === HUMAN_NAME) return 'human posted';
  return `${message.from} posted`;
}

function concernsMember({
  as,
  message,
  room,
  store,
}: {
  as: string;
  message: Message;
  room: string;
  store: RoomStore;
}) {
  const members = store.listMembers(room);
  const member = members.find(item => item.name === as);
  return member !== undefined && concerns({ member, members, message, pausedWith: store.pausedWith(room) });
}

// Reads past the bookmark without moving it: wait only counts, read_since moves it.
function unseen({ as, room, store }: { as: string; room: string; store: RoomStore }) {
  const member = store.listMembers(room).find(item => item.name === as);
  if (!member) return [];
  const read = store.readUnseen({ afterId: member.cursor, as, room });
  return read.ok ? read.messages : [];
}

function summary({ as, hit, mark, store }: { as: string; hit: Hit; mark: number; store: RoomStore }) {
  const posts = unseen({ as, room: hit.room, store }).filter(
    message => message.kind === 'chat' || message.kind === 'done',
  );
  const fresh = posts.filter(message => message.id > mark).length;
  const backlog = posts.length - fresh;
  const counts = [
    ...(fresh || !backlog ? [`${fresh} new since your last read`] : []),
    ...(backlog ? [`${backlog} unread from before you joined this session (backlog)`] : []),
  ].join(' and ');
  return `${counts} in #${hit.room} (${reasonFor({ as, message: hit.message })}). Call read_since.`;
}

function block({
  ctx,
  rooms,
  store,
  timeoutS,
}: {
  ctx: ServerContext;
  rooms: Map<string, string>;
  store: RoomStore;
  timeoutS: number;
}) {
  const { signal } = ctx.mcpReq;
  // oxlint-disable-next-line no-underscore-dangle -- MCP names the request meta _meta.
  const token = ctx.mcpReq._meta?.progressToken;
  const label = [...rooms.keys()].map(room => `#${room}`).join(' ');
  return new Promise<Hit | undefined>(resolve => {
    const cleanups: (() => void)[] = [];
    const stop = (hit?: Hit) => {
      cleanups.forEach(cleanup => cleanup());
      resolve(hit);
    };
    cleanups.push(
      store.events.on(({ event }) => {
        if (event.type !== 'message') return;
        const as = rooms.get(event.room);
        if (as && concernsMember({ as, message: event.message, room: event.room, store })) {
          stop({ message: event.message, room: event.room });
        }
      }),
    );
    const timer = setTimeout(() => stop(), timeoutS * 1000);
    cleanups.push(() => clearTimeout(timer));
    let elapsed = 0;
    const ticker = setInterval(() => {
      elapsed += PROGRESS_EVERY_MS / 1000;
      if (token === undefined) return;
      ctx.mcpReq
        .notify({
          method: 'notifications/progress',
          params: { message: `waiting on ${label}`, progress: elapsed, progressToken: token, total: timeoutS },
        })
        .catch(() => {});
    }, PROGRESS_EVERY_MS);
    cleanups.push(() => clearInterval(ticker));
    const onAbort = () => stop();
    signal.addEventListener('abort', onAbort);
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) stop();
  });
}

/** Registers `wait`: blocks until a message concerns the caller, then reports a count. Never moves the bookmark. */
export function registerWait(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'wait', { deps, description, inputSchema: waitInputSchema }, async (input, ctx) => {
    if (input.room && !session.rooms.has(input.room)) return notJoined(input.room);
    const rooms = new Map([...session.rooms].filter(([room]) => input.room === undefined || room === input.room));
    if (!rooms.size) return refuse('you have not joined a room. call join first.');

    for (const [room, as] of rooms) {
      const message = unseen({ as, room, store }).find(item => concernsMember({ as, message: item, room, store }));
      if (message) return reply(summary({ as, hit: { message, room }, mark: session.markOf(room), store }));
    }

    rooms.forEach((as, room) => store.touch({ as, room, state: 'waiting' }));
    const limit = waitLimitFor(server.server.getClientVersion()?.name);
    const timeoutS = Math.min(input.timeout_s ?? limit.defaultS, limit.maxS);
    const hit = await block({ ctx, rooms, store, timeoutS });
    // A session that ended mid-wait left its members gone. Reading or touching would bring them back.
    const held = [...rooms].filter(([room, as]) => session.rooms.get(room) === as);
    held.forEach(([room, as]) => store.touch({ as, room, state: 'active' }));
    session.seen();
    const live = hit && held.some(([room]) => room === hit.room) ? hit : undefined;
    return reply(
      live ? summary({ as: rooms.get(live.room)!, hit: live, mark: session.markOf(live.room), store }) : NOTHING_YET,
    );
  });
}
