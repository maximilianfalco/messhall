import type { History, SearchResult } from '../../contracts/feed.ts';
import type { Keys } from '../daemon/keys.js';
import type { Handler, Route } from '../daemon/router.js';
import type { Spawner } from '../flock/spawner.js';
import type { RoomStore } from '../rooms/store.js';
import type { Relay } from './human.js';
import type { Every } from './sse.js';

import { z } from 'zod';

import { nameSchema } from '../../contracts/room.ts';
import { FEED_PAGE_DEFAULT, FEED_PAGE_MAX, SEARCH_LIMIT } from '../config.js';
import { sendJson } from '../daemon/router.js';

import { roomTarget } from './http.js';
import { humanRoutes } from './human.js';
import { buildSnapshot } from './snapshot.js';
import { eventStream, intervalTimer } from './sse.js';

const pageQuerySchema = z
  .object({
    after: z.coerce.number().int().nonnegative().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().default(FEED_PAGE_DEFAULT),
  })
  .refine(query => query.after === undefined || query.before === undefined);

const searchQuerySchema = z.object({
  limit: z.coerce.number().int().positive().default(SEARCH_LIMIT),
  q: z.string().trim().min(1),
  room: nameSchema.optional(),
});

/** Every feed route. Reads take either key, the human-seat writes take the human key only. */
export function feedRoutes({
  every = intervalTimer,
  keys,
  now,
  relay,
  spawner,
  store,
}: {
  every?: Every;
  keys: Keys;
  now: () => Date;
  relay: Relay;
  spawner: Spawner;
  store: RoomStore;
}) {
  const read = (handler: Handler) => keys.requireKey(['agent', 'human'], handler);

  const history: Handler = (req, res) => {
    const target = roomTarget(req);
    if (target?.action !== 'messages') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const query = pageQuerySchema.safeParse(Object.fromEntries(target.query));
    if (!query.success) {
      sendJson(res, 400, {
        error: 'after or before is a message id, not both, and limit a positive whole number',
      });
      return;
    }
    const { after, before, limit } = query.data;
    const page = store.listMessages({ after, before, limit: Math.min(limit, FEED_PAGE_MAX), room: target.name });
    if (page.ok) sendJson(res, 200, { messages: page.messages } satisfies History);
    else sendJson(res, 404, { error: 'no such room' });
  };

  const search: Handler = (req, res) => {
    const { searchParams } = new URL(req.url ?? '/', 'http://127.0.0.1');
    const query = searchQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!query.success) {
      sendJson(res, 400, { error: 'q is the text to find, room a room name and limit a positive whole number' });
      return;
    }
    const { limit, q, room } = query.data;
    const result = store.searchMessages({ limit: Math.min(limit, FEED_PAGE_MAX), q, room });
    if (result.ok) sendJson(res, 200, { messages: result.messages } satisfies SearchResult);
    else sendJson(res, 404, { error: 'no such room' });
  };

  const routes: Route[] = [
    { handle: read((_req, res) => sendJson(res, 200, buildSnapshot({ store }))), method: 'GET', path: '/api/snapshot' },
    { handle: read(eventStream({ every, now, store })), method: 'GET', path: '/api/events' },
    { handle: read(history), method: 'GET', path: '/api/rooms/*' },
    { handle: read(search), method: 'GET', path: '/api/search' },
    ...humanRoutes({ keys, relay, spawner, store }),
  ];
  return routes;
}
