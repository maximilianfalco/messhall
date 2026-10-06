import type { Ringer, RingInput } from '../doorbell/ringers.js';
import type { McpSession } from '../mcp/session.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { logger } from '../lib/logger.js';

export const CHANNEL_METHOD = 'notifications/claude/channel';

export interface ChannelEntry {
  server: { server: Pick<McpServer['server'], 'notification'> };
  session: Pick<McpSession, 'id' | 'kind'>;
}

/** Claude Code already shows the server name, so the ring drops its own `messhall: ` lead. */
const CLAUDE_PREFIX = 'messhall: ';

/**
 * Rings Claude Code over Channels: one notification on each live claude session that holds the
 * member. Claude Code sends no ack, and a session that went away is dropped, so wait still works.
 */
export function createClaudeRinger({
  sessionsFor,
}: {
  sessionsFor: (query: { name: string; room: string }) => ChannelEntry[];
}) {
  const ringer: Ringer = {
    kind: 'claude',
    async ring({ member, meta, text }: RingInput) {
      const content = text.startsWith(CLAUDE_PREFIX) ? text.slice(CLAUDE_PREFIX.length) : text;
      const byId = new Map(
        member.rooms
          .flatMap(room => sessionsFor({ name: member.name, room }))
          .filter(entry => entry.session.kind === 'claude')
          .map(entry => [entry.session.id, entry]),
      );
      const sent = await Promise.all(
        [...byId.values()].map(entry =>
          entry.server.server
            .notification({ method: CHANNEL_METHOD, params: { content, meta } })
            .then(() => true)
            .catch((error: unknown) => {
              logger.info('doorbell session gone', { error: String(error), session: entry.session.id });
              return false;
            }),
        ),
      );
      return sent.filter(Boolean).length;
    },
  };
  return ringer;
}
