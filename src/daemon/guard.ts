import type { Handler } from './router.js';
import type { IncomingHttpHeaders } from 'node:http';

import { sendJson } from './router.js';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

/** Why a request may not come in, or undefined when it may. Any Origin means a browser,
 * and a Host other than ours means DNS rebinding. */
export function refusal({ headers, port }: { headers: IncomingHttpHeaders; port: number }) {
  if (headers.origin !== undefined) return 'origin' as const;
  const host = headers.host?.toLowerCase();
  const allowed = LOCAL_HOSTS.flatMap(name => [name, `${name}:${port}`]);
  return host !== undefined && allowed.includes(host) ? undefined : ('host' as const);
}

/** Wraps the whole daemon so every route, `/health` too, refuses foreign hosts and browsers with 403. */
export function guarded({ port }: { port: number }, handler: Handler) {
  return ((req, res) => {
    const reason = refusal({ headers: req.headers, port });
    if (reason) {
      sendJson(res, 403, { error: reason === 'origin' ? 'browser requests are refused' : 'unknown host' });
      return;
    }
    return handler(req, res);
  }) satisfies Handler;
}
