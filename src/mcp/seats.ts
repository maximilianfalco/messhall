import type { AgentKind } from '../../contracts/room.ts';
import type { ToolDeps } from './tools/registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { clientType } from './constants.js';

/** True when the doorbell can ring this session over the Claude channel. A bridge suffix on the name is fine. */
export function ringsByChannel({ client, kind }: { client: string | undefined; kind: AgentKind }) {
  return kind === 'claude' || (client ? clientType(client).channel : false);
}

/** Binds a seat the store just gave this session. Any other session holding the name lets go, so only one posts as it. */
export function bindSeat({
  client,
  kind,
  name,
  room,
  session,
  sessions,
  store,
  threadId,
}: Pick<ToolDeps, 'session' | 'sessions' | 'store'> & {
  client: { name: string } | undefined;
  kind: AgentKind;
  name: string;
  room: string;
  threadId?: string;
}) {
  sessions
    .sessionsFor({ name, room })
    .filter(entry => entry.session !== session)
    .forEach(entry => entry.session.unbind(room));
  const newest = store.listMessages({ limit: 1, room });
  const mark = newest.ok ? (newest.messages.at(-1)?.id ?? 0) : 0;
  session.bind({ channel: ringsByChannel({ client: client?.name, kind }), kind, mark, name, room, threadId });
}

/**
 * Sits this session in each seat its key holds. A reconnect opens a few sessions and calls on any one, so a
 * live holder that never called lets go. One that called keeps it, since a child process shares the key.
 */
export function reattachSeats({
  server,
  session,
  sessions,
  store,
}: Pick<ToolDeps, 'session' | 'sessions' | 'store'> & { server: McpServer }) {
  const { seat } = session;
  if (!seat) return;
  const client = server.server.getClientVersion();
  store.seatsOf(seat).forEach(({ kind, name, room }) => {
    if (session.rooms.get(room) === name) return;
    const live = sessions.sessionsFor({ name, room }).filter(entry => !entry.session.dead());
    if (live.some(entry => entry.session.called)) return;
    // A live sibling already sat down in the store, so only the binding moves, with no second line.
    const seated =
      live.length > 0 || store.joinRoom({ as: name, client, kind, reattach: true, room, seatKey: seat }).ok;
    if (!seated) return;
    bindSeat({ client, kind, name, room, session, sessions, store });
  });
}
