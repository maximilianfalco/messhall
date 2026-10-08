import type { McpSession } from '../../mcp/session.js';
import type { Ringer, RingInput } from '../ringer.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { randomUUID } from 'node:crypto';

import { logger } from '../../lib/logger.js';

export const CHANNEL_METHOD = 'notifications/claude/channel';

export interface ChannelEntry {
  server: { server: Pick<McpServer['server'], 'notification'> };
  session: Pick<McpSession, 'channel' | 'checkDoorbell' | 'doorbell' | 'id'>;
}

const checkLine = (id: string) => `call doorbell_ok with id ${id}. nothing else to do, then carry on.`;

/** Channel clients already show the server name, so the ring drops its own `messhall: ` lead. */
const CLAUDE_PREFIX = 'messhall: ';

/**
 * Rings any client that takes Claude Channels: one notification on each live channel session that
 * holds the member. A session that failed its doorbell check still gets it, since a busy claude may answer late,
 * but counts as unconfirmed, and its ring carries a fresh check id to answer with doorbell_ok. A session that went
 * away is dropped, so wait still works.
 */
export function createChannelRinger({
  sessionsFor,
}: {
  sessionsFor: (query: { name: string; room: string }) => ChannelEntry[];
}) {
  const ringer: Ringer = {
    kinds: ['claude', 'other'],
    async ring({ member, meta, text }: RingInput) {
      const lead = text.startsWith(CLAUDE_PREFIX) ? text.slice(CLAUDE_PREFIX.length) : text;
      const byId = new Map(
        member.rooms
          .flatMap(room => sessionsFor({ name: member.name, room }))
          .filter(entry => entry.session.channel)
          .map(entry => [entry.session.id, entry]),
      );
      const sent = await Promise.all(
        [...byId.values()].map(entry => {
          const { doorbell } = entry.session;
          const check = doorbell === 'off' ? randomUUID() : undefined;
          if (check) entry.session.checkDoorbell(check);
          const content = check ? `${lead} ${checkLine(check)}` : lead;
          return entry.server.server
            .notification({
              method: CHANNEL_METHOD,
              params: { content, meta: check ? { ...meta, doorbell_check: check } : meta },
            })
            .then(() => doorbell)
            .catch((error: unknown) => {
              logger.info('doorbell session gone', { error: String(error), session: entry.session.id });
              return undefined;
            });
        }),
      );
      const reached = sent.filter(doorbell => doorbell !== undefined);
      return { sessions: reached.length, unconfirmed: reached.filter(doorbell => doorbell === 'off').length };
    },
  };
  return ringer;
}

/**
 * Sends the one test ring a seated channel session gets. A plain claude drops the channel in silence,
 * so only a doorbell_ok with this id shows the ring got through.
 */
export function checkDoorbell({ server, session }: { server: ChannelEntry['server']; session: McpSession }) {
  if (!session.channel || session.rooms.size === 0 || session.doorbell !== 'unchecked') return;
  const id = randomUUID();
  session.checkDoorbell(id);
  const content = `doorbell check: ${checkLine(id)}`;
  server.server
    .notification({ method: CHANNEL_METHOD, params: { content, meta: { doorbell_check: id } } })
    .catch((error: unknown) => logger.info('doorbell check not sent', { error: String(error), session: session.id }));
}
