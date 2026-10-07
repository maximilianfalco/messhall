import type { Handler } from '../daemon/router.js';
import type { RoomStore } from '../rooms/store.js';
import type { McpSession } from './session.js';
import type { ToolDeps } from './tools/registry.js';
import type { McpServer } from '@modelcontextprotocol/server';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { randomUUID } from 'node:crypto';

import {
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport,
} from '@modelcontextprotocol/node';
import { DEFAULT_MAX_REQUEST_BODY_SIZE, isInitializeRequest } from '@modelcontextprotocol/server';

import { sendJson } from '../daemon/router.js';
import { logger } from '../lib/logger.js';

import { SEAT_HEADER } from './constants.js';
import { createRelay } from './permission.js';
import { reattachSeats } from './seats.js';
import { createMesshallServer } from './server.js';
import { createSession, createSessionRegistry } from './session.js';

export const MCP_PATH = '/mcp';
export const MCP_METHODS = ['POST', 'GET', 'DELETE'] as const;

export interface McpEntry {
  server: McpServer;
  session: McpSession;
  transport: NodeStreamableHTTPServerTransport;
}

const rpcError = (res: ServerResponse, status: number, message: string) =>
  sendJson(res, status, { error: { code: -32_000, message }, id: null, jsonrpc: '2.0' });

// One read of the header. Empty when the launcher set no seat, which means no key.
function seatOf(req: IncomingMessage) {
  const value = req.headers[SEAT_HEADER];
  return typeof value === 'string' && value ? value : undefined;
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > DEFAULT_MAX_REQUEST_BODY_SIZE) return null;
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The `/mcp` endpoint: one transport and one McpServer per `Mcp-Session-Id`. A session ends on
 * DELETE, on transport close, or when the sweep finds it dead, and its members turn away. A new
 * session that sends a seat key sits down again in every seat that key holds whose holder is dead.
 */
export function createMcpEndpoint({
  codex,
  now,
  store,
}: {
  codex: ToolDeps['codex'];
  now: () => Date;
  store: RoomStore;
}) {
  const sessions = createSessionRegistry<McpEntry>();
  const hostOk = localhostHostValidation();
  const originOk = localhostOriginValidation();

  function end(entry: McpEntry) {
    if (!sessions.get(entry.session.id)) return;
    sessions.remove(entry.session.id);
    [...entry.session.rooms].forEach(([room, as]) => {
      entry.session.unbind(room);
      store.touch({ as, room, state: 'away' });
    });
    // Its open dialogs closed with it, so its asks can no longer be answered.
    store.expireApprovals({ session: entry.session.id });
    logger.info('mcp session closed', { session: entry.session.id });
  }

  async function open(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req);
    if (!isInitializeRequest(body)) {
      rpcError(res, 400, 'no session: send initialize first');
      return;
    }
    const session = createSession({ id: randomUUID(), now, seat: seatOf(req) });
    const server = createMesshallServer({ codex, now, session, sessions, store });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => session.id });
    const entry: McpEntry = { server, session, transport };
    transport.onclose = () => end(entry);
    await server.connect(transport);
    sessions.add(entry);
    res.once('close', session.hold());
    await transport.handleRequest(req, res, body);
    if (!transport.sessionId) {
      sessions.remove(session.id);
      return;
    }
    logger.info('mcp session opened', { session: session.id });
    reattachSeats({ server, session, sessions, store });
  }

  const handle: Handler = async (req, res) => {
    if (!hostOk(req, res) || !originOk(req, res)) return;
    const id = req.headers['mcp-session-id'];
    if (id === undefined) {
      if (req.method === 'POST') return open(req, res);
      rpcError(res, 400, 'no session: send initialize first');
      return;
    }
    const entry = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!entry) {
      rpcError(res, 404, 'session not found: initialize again');
      return;
    }
    res.once('close', entry.session.hold());
    await entry.transport.handleRequest(req, res);
  };

  return {
    /** Closes every session for a shutdown. Seats stay as they were, so the next start marks them reconnecting
     * and wakes them, not away. */
    async close() {
      const live = sessions.all();
      live.forEach(entry => sessions.remove(entry.session.id));
      await Promise.all(live.map(entry => entry.transport.close()));
    },
    handle,
    /** Closes dead sessions: no GET stream, no open request and no call for a minute. Returns how many closed. */
    async sweep() {
      const dead = sessions.all().filter(entry => entry.session.dead());
      await Promise.all(dead.map(entry => entry.transport.close()));
      return dead.length;
    },
    /** Sends the human's verdict to the session that asked. False when it is gone. */
    relay: createRelay(sessions),
    /** True when a live session holding `name` in `room` can be rung, so a quiet seat reads idle, not away. */
    ringable: (seat: { name: string; room: string }) =>
      sessions.sessionsFor(seat).some(entry => entry.session.ringable),
    /** The live sessions holding `name` in `room`, so the doorbell can ring through each one's server. */
    sessionsFor: sessions.sessionsFor,
  };
}

export type McpEndpoint = ReturnType<typeof createMcpEndpoint>;
