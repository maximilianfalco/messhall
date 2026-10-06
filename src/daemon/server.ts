import type { Health } from '../../contracts/health.ts';
import type { RoomStore } from '../rooms/store.js';
import type { Handler, Route } from './router.js';
import type { Server } from 'node:http';

import { createServer } from 'node:http';

import { createClaudeRinger } from '../channels/claude.js';
import { CLI_VERSION, DAEMON_HOST, PRESENCE_SWEEP_MS } from '../config.js';
import { startDoorbell } from '../doorbell/doorbell.js';
import { createRingers } from '../doorbell/ringers.js';
import { logger } from '../lib/logger.js';
import { runCommand } from '../lib/run.js';
import { createMcpEndpoint, MCP_METHODS, MCP_PATH } from '../mcp/transport.js';
import { openDb } from '../rooms/db.js';
import { createRoomStore } from '../rooms/store.js';

import { guarded } from './guard.js';
import { loadKeys } from './keys.js';
import { createRouter, sendJson } from './router.js';

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/** The pid listening on `port`, from lsof, or undefined when lsof cannot tell. */
export async function lsofPortHolder(port: number) {
  const result = await runCommand('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  return result.stdout.trim().split('\n')[0] || undefined;
}

function listen(server: Server, port: number) {
  return new Promise<{ ok: false } | { ok: true; port: number }>((resolve, reject) => {
    const onError = (error: Error) => {
      if ('code' in error && error.code === 'EADDRINUSE') resolve({ ok: false });
      else reject(error);
    };
    server.once('error', onError);
    server.listen(port, DAEMON_HOST, () => {
      server.off('error', onError);
      const address = server.address();
      resolve({ ok: true, port: typeof address === 'object' && address ? address.port : port });
    });
  });
}

function health({ now, startedAt, store }: { now: () => Date; startedAt: number; store: RoomStore }) {
  const rooms = store.listRooms();
  const live = rooms
    .flatMap(room => store.listMembers(room.name))
    .filter(member => member.kind !== 'human' && member.presence !== 'gone');
  const body: Health = {
    live_members: live.length,
    ok: true,
    rooms: rooms.length,
    uptime_s: Math.floor((now().getTime() - startedAt) / 1000),
    version: CLI_VERSION,
  };
  return body;
}

function caught(handler: Handler) {
  return (async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(asError(error), { message: 'request failed', method: req.method, url: req.url });
      if (res.headersSent) res.end();
      else sendJson(res, 500, { error: 'internal error' });
    }
  }) satisfies Handler;
}

/** Opens the store and key files, binds 127.0.0.1 and sweeps presence on a timer.
 * A taken port gives `port_taken` with the pid that holds it, never a quiet move. */
export async function startDaemon({
  dataDir,
  findPortHolder = lsofPortHolder,
  now,
  port,
  sweepEveryMs = PRESENCE_SWEEP_MS,
}: {
  dataDir: string;
  findPortHolder?: (port: number) => Promise<string | undefined>;
  now: () => Date;
  port: number;
  sweepEveryMs?: number;
}) {
  // Bind first, so a second daemon on a taken port never opens the db.
  const server = createServer();
  const bound = await listen(server, port);
  if (!bound.ok) return { ok: false, pid: await findPortHolder(port), port, reason: 'port_taken' } as const;

  const keys = loadKeys({ dataDir });
  const db = openDb({ dataDir });
  const store = createRoomStore({ db, now });
  const mcp = createMcpEndpoint({ now, store });
  const ringers = createRingers([createClaudeRinger({ sessionsFor: mcp.sessionsFor })]);
  const stopDoorbell = startDoorbell({ now, ringers, store });
  const startedAt = now().getTime();

  // The feed mounts under /api here.
  const routes: Route[] = [
    { handle: (_req, res) => sendJson(res, 200, health({ now, startedAt, store })), method: 'GET', path: '/health' },
    ...MCP_METHODS.map(method => ({ handle: keys.requireKey('agent', mcp.handle), method, path: MCP_PATH })),
  ];
  server.on('request', guarded({ port: bound.port }, caught(createRouter(routes))));

  const sweep = setInterval(() => {
    try {
      store.sweepPresence();
    } catch (error) {
      logger.error(asError(error), { message: 'presence sweep failed' });
    }
    mcp.sweep().catch((error: unknown) => logger.error(asError(error), { message: 'mcp session sweep failed' }));
  }, sweepEveryMs);

  const url = `http://${DAEMON_HOST}:${bound.port}`;
  logger.info('daemon up', { data_dir: dataDir, pid: process.pid, port: bound.port, url, version: CLI_VERSION });

  const daemon = {
    /** Stops the sweep and the doorbell, ends every MCP session, drops open connections and closes the db. */
    async close() {
      clearInterval(sweep);
      stopDoorbell();
      await mcp.close();
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      db.close();
    },
    port: bound.port,
    /** The live MCP sessions holding a name in a room, for the doorbell. */
    sessionsFor: mcp.sessionsFor,
    url,
  };
  return { daemon, ok: true } as const;
}

export type Daemon = Extract<Awaited<ReturnType<typeof startDaemon>>, { ok: true }>['daemon'];
