import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export interface Route {
  handle: Handler;
  method: string;
  // An exact path, or a prefix ending in a slash and a star.
  path: string;
}

/** Sends `body` as JSON with `status`. */
export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const matches = (route: string, pathname: string) =>
  route.endsWith('/*') ? pathname.startsWith(route.slice(0, -1)) : route === pathname;

/** Sends each request to the first route with its method and path, else a JSON 404. */
export function createRouter(routes: Route[]) {
  return ((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = routes.find(item => item.method === req.method && matches(item.path, pathname));
    if (!route) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    return route.handle(req, res);
  }) satisfies Handler;
}
