import type { IncomingMessage } from 'node:http';

import { NAME_PATTERN } from '../../contracts/room.ts';
import { FEED_BODY_MAX_BYTES } from '../config.js';

const ROOM_PATH = /^\/api\/rooms\/([^/]+)\/([^/]+)$/;
const MEMBER_ACTION_PATH = /^\/api\/rooms\/([^/]+)\/members\/([^/]+)\/([^/]+)$/;

/** The room name and action in `/api/rooms/<name>/<action>`, or undefined when the path is not one. */
export function roomTarget(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const [, name, action] = ROOM_PATH.exec(url.pathname) ?? [];
  if (!name || !action || !NAME_PATTERN.test(name)) return;
  return { action, name, query: url.searchParams };
}

/** The room, member and action in `/api/rooms/<name>/members/<member>/<action>`, or undefined when the path is not one. */
export function memberAction(req: IncomingMessage) {
  const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
  const [, room, member, action] = MEMBER_ACTION_PATH.exec(pathname) ?? [];
  if (!room || !member || !action || !NAME_PATTERN.test(room) || !NAME_PATTERN.test(member)) return;
  return { action, member, room };
}

/** The request body parsed as JSON, or `ok: false` when it is too big or not JSON. */
export async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > FEED_BODY_MAX_BYTES) return { ok: false } as const;
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { ok: true, value } as const;
  } catch {
    return { ok: false } as const;
  }
}
