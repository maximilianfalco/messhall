import type { Build, Health } from '../../contracts/health.ts';
import type { RoomStore } from '../rooms/store.js';
import type { Handler, Route } from './router.js';
import type { Server } from 'node:http';

import { createServer } from 'node:http';

import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import { createCodexClient } from '../codex/client.js';
import { claudeBin, CLI_VERSION, codexControlSocket, DAEMON_HOST, summariesOff, SWEEP_EVERY_MS } from '../config.js';
import { startDoorbell } from '../doorbell/doorbell.js';
import { createRingers } from '../doorbell/ringer.js';
import { createChannelRinger } from '../doorbell/ringers/channel.js';
import { createCodexRinger } from '../doorbell/ringers/codex.js';
import { wakeSeats } from '../doorbell/wake.js';
import { feedRoutes } from '../feed/routes.js';
import { createSpawner } from '../flock/spawner.js';
import { tmux as runTmux, type Tmux } from '../flock/tmux.js';
import { askClaude } from '../lib/claude.js';
import { logger } from '../lib/logger.js';
import { runCommand } from '../lib/run.js';
import { createMcpEndpoint, MCP_METHODS, MCP_PATH } from '../mcp/transport.js';
import { openDb } from '../rooms/db.js';
import { createRoomStore } from '../rooms/store.js';
import { startSummaries } from '../rooms/summaries.js';

import { currentBuild } from './build.js';
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

function health({
  build,
  now,
  startedAt,
  store,
}: {
  build: Build | null;
  now: () => Date;
  startedAt: number;
  store: RoomStore;
}) {
  const rooms = store.listRooms();
  const live = rooms
    .flatMap(room => store.listMembers(room.name))
    .filter(member => member.kind !== 'human' && member.presence !== 'away');
  const body: Health = {
    build,
    contract_version: FEED_CONTRACT_VERSION,
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

/** Opens the store and key files, marks members from the last run away, binds 127.0.0.1 and sweeps on a timer.
 * A taken port gives `port_taken` with the pid that holds it, never a quiet move. */
export async function startDaemon({
  dataDir,
  findPortHolder = lsofPortHolder,
  now,
  port,
  sweepEveryMs = SWEEP_EVERY_MS,
  tmux = runTmux,
}: {
  dataDir: string;
  findPortHolder?: (port: number) => Promise<string | undefined>;
  now: () => Date;
  port: number;
  sweepEveryMs?: number;
  tmux?: Tmux;
}) {
  // Bind first, so a second daemon on a taken port never opens the db.
  const server = createServer();
  const bound = await listen(server, port);
  if (!bound.ok) return { ok: false, pid: await findPortHolder(port), port, reason: 'port_taken' } as const;

  const keys = loadKeys({ dataDir });
  const db = openDb({ dataDir });
  const store = createRoomStore({ db, now });
  // No session lives through a restart, so every seat from the last run is away until its agent comes back.
  store.markReconnecting();
  const codex = createCodexClient({ socketPath: codexControlSocket() });
  const mcp = createMcpEndpoint({ codex, now, store });
  const ringers = createRingers([
    createChannelRinger({ sessionsFor: mcp.sessionsFor }),
    createCodexRinger({ codex, sessionsFor: mcp.sessionsFor }),
  ]);
  const doorbell = startDoorbell({ now, ringers, store });
  const claude = claudeBin();
  const stopSummaries = summariesOff()
    ? () => {}
    : startSummaries({ claude: options => askClaude({ ...options, bin: claude }), store });
  const startedAt = now().getTime();
  // Read once at start, so a later pull shows this daemon as older than the install.
  const build = currentBuild();
  const url = `http://${DAEMON_HOST}:${bound.port}`;

  // MCP mounts at /mcp and the feed under /api here.
  const routes: Route[] = [
    {
      handle: (_req, res) => sendJson(res, 200, health({ build, now, startedAt, store })),
      method: 'GET',
      path: '/health',
    },
    ...MCP_METHODS.map(method => ({ handle: keys.requireKey('agent', mcp.handle), method, path: MCP_PATH })),
    ...feedRoutes({ build, keys, now, relay: mcp.relay, spawner: createSpawner({ dataDir, store, url }), store }),
  ];
  server.on('request', guarded({ port: bound.port }, caught(createRouter(routes))));

  const sweep = setInterval(() => {
    try {
      store.sweepPresence({ ringable: mcp.ringable });
      store.clearStale();
      store.expireInvites();
      doorbell.endPauses();
      doorbell.nudgeReviews();
      // relay never rejects: a gone session only gives false.
      store.expireApprovals().forEach(ask => mcp.relay({ ...ask, behavior: 'deny' }));
      store.expireQuestions();
    } catch (error) {
      logger.error(asError(error), { message: 'presence sweep failed' });
    }
    mcp.sweep().catch((error: unknown) => logger.error(asError(error), { message: 'mcp session sweep failed' }));
  }, sweepEveryMs);

  // A spawned agent idle at the restart lost its event stream, so nothing rings it until it is woken.
  wakeSeats({ codex, dataDir, seats: store.wakeableSeats(), tmux })
    .then(woken => woken.forEach(target => logger.info('woke a seat after the restart', target)))
    .catch((error: unknown) => logger.error(asError(error), { message: 'wake after restart failed' }));

  logger.info('daemon up', {
    claude,
    data_dir: dataDir,
    pid: process.pid,
    port: bound.port,
    url,
    version: CLI_VERSION,
  });

  const daemon = {
    /** Stops the sweep, the doorbell and summaries, ends every MCP session, drops open connections and closes the db. */
    async close() {
      clearInterval(sweep);
      doorbell.stop();
      stopSummaries();
      codex.close();
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
