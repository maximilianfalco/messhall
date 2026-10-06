import type { History } from '../../contracts/feed.ts';
import type { Keys } from '../daemon/keys.js';
import type { Handler, Route } from '../daemon/router.js';
import type { RoomStore } from '../rooms/store.js';
import type { Every } from './sse.js';

import { z } from 'zod';

import { FEED_PAGE_DEFAULT, FEED_PAGE_MAX } from '../config.js';
import { sendJson } from '../daemon/router.js';

import { roomTarget } from './http.js';
import { humanRoutes } from './human.js';
import { buildSnapshot } from './snapshot.js';
import { eventStream, intervalTimer } from './sse.js';

const pageQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().default(FEED_PAGE_DEFAULT),
});

/** Every feed route. Reads take either key, the human-seat writes take the human key only. */
export function feedRoutes({
  every = intervalTimer,
  keys,
  now,
  store,
}: {
  every?: Every;
  keys: Keys;
  now: () => Date;
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
      sendJson(res, 400, { error: 'after is a message id and limit a positive whole number' });
      return;
    }
    const { after, limit } = query.data;
    const page = store.listMessages({ after, limit: Math.min(limit, FEED_PAGE_MAX), room: target.name });
    if (page.ok) sendJson(res, 200, { messages: page.messages } satisfies History);
    else sendJson(res, 404, { error: 'no such room' });
  };

  const routes: Route[] = [
    { handle: read((_req, res) => sendJson(res, 200, buildSnapshot({ store }))), method: 'GET', path: '/api/snapshot' },
    { handle: read(eventStream({ every, now, store })), method: 'GET', path: '/api/events' },
    { handle: read(history), method: 'GET', path: '/api/rooms/*' },
    ...humanRoutes({ keys, store }),
  ];
  return routes;
}
