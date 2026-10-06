import type { Handler } from '../daemon/router.js';
import type { RoomStore } from '../rooms/store.js';
import type { McpSession } from './session.js';
import type { McpServer } from '@modelcontextprotocol/server';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { randomUUID } from 'node:crypto';

import {
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport,
} from '@modelcontextprotocol/node';
import { DEFAULT_MAX_REQUEST_BODY_SIZE, isInitializeRequest } from '@modelcontextprotocol/server';

import { SESSION_IDLE_MS } from '../config.js';
import { sendJson } from '../daemon/router.js';
import { logger } from '../lib/logger.js';

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
 * DELETE, on transport close, or after 30 idle minutes, and its members turn gone.
 */
export function createMcpEndpoint({ now, store }: { now: () => Date; store: RoomStore }) {
  const sessions = createSessionRegistry<McpEntry>();
  const hostOk = localhostHostValidation();
  const originOk = localhostOriginValidation();

  function end(entry: McpEntry) {
    if (!sessions.get(entry.session.id)) return;
    sessions.remove(entry.session.id);
    [...entry.session.rooms].forEach(([room, as]) => {
      entry.session.unbind(room);
      store.touch({ as, room, state: 'gone' });
    });
    logger.info('mcp session closed', { session: entry.session.id });
  }

  async function open(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req);
    if (!isInitializeRequest(body)) {
      rpcError(res, 400, 'no session: send initialize first');
      return;
    }
    const session = createSession({ id: randomUUID(), now });
    const server = createMesshallServer({ now, session, sessions, store });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => session.id });
    const entry: McpEntry = { server, session, transport };
    transport.onclose = () => end(entry);
    await server.connect(transport);
    sessions.add(entry);
    res.once('close', session.hold());
    await transport.handleRequest(req, res, body);
    if (transport.sessionId) logger.info('mcp session opened', { session: session.id });
    else sessions.remove(session.id);
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
    /** Closes every session, marking their members gone. */
    async close() {
      await Promise.all(sessions.all().map(entry => entry.transport.close()));
    },
    handle,
    /** Closes sessions with no open request for 30 minutes. Returns how many closed. */
    async sweep() {
      const cutoff = now().getTime() - SESSION_IDLE_MS;
      const idle = sessions.all().filter(entry => entry.session.idleSince(cutoff));
      await Promise.all(idle.map(entry => entry.transport.close()));
      return idle.length;
    },
    /** The live sessions holding `name` in `room`, so the doorbell can ring through each one's server. */
    sessionsFor: sessions.sessionsFor,
  };
}

export type McpEndpoint = ReturnType<typeof createMcpEndpoint>;
