import type { CodexClient } from '../../codex/client.js';
import type { McpSession } from '../../mcp/session.js';
import type { Ringer, RingInput } from '../ringer.js';

import { randomUUID } from 'node:crypto';

import { logger } from '../../lib/logger.js';

export interface CodexEntry {
  session: Pick<McpSession, 'dropThread' | 'id' | 'kind' | 'threadId'>;
}

/** Rings Codex by queueing the ring line on each checked thread. The queue waits out a busy turn or an
 * approval, so a ring never cuts in. A failed add drops the thread, so the member falls back to wait. */
export function createCodexRinger({
  codex,
  sessionsFor,
}: {
  codex: Pick<CodexClient, 'request'>;
  sessionsFor: (query: { name: string; room: string }) => CodexEntry[];
}) {
  const ringer: Ringer = {
    kinds: ['codex'],
    async ring({ member, text }: RingInput) {
      const byThread = new Map(
        member.rooms
          .flatMap(room => sessionsFor({ name: member.name, room }))
          .flatMap(entry =>
            entry.session.kind === 'codex' && entry.session.threadId ? [[entry.session.threadId, entry] as const] : [],
          ),
      );
      const sent = await Promise.all(
        [...byThread].map(async ([threadId, entry]) => {
          const added = await codex.request('thread/queue/add', {
            clientUserMessageId: randomUUID(),
            input: [{ text, text_elements: [], type: 'text' }],
            threadId,
          });
          if (added.ok) return true;
          logger.info('codex doorbell lost, falling back to wait', { error: added.error, session: entry.session.id });
          entry.session.dropThread();
          return false;
        }),
      );
      return sent.filter(Boolean).length;
    },
  };
  return ringer;
}
