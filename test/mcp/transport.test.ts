import type { Daemon } from '../../src/daemon/server.js';
import type { Client } from '@modelcontextprotocol/client';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DAEMON_HOST, SESSION_IDLE_MS } from '../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { connectHttp } from '../../src/mcp/testing.js';
import { createMcpEndpoint } from '../../src/mcp/transport.js';
import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';
import { fakeCodexRpc } from '../codex/fakeCodex.js';

import { textOf } from './harness.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const INIT_ACCEPT = 'application/json, text/event-stream';

let home: string;
let at: number;
let daemon: Daemon | undefined;
let clients: Client[];
const now = () => new Date(at);

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-mcp-'));
  at = T0;
  clients = [];
  vi.stubEnv('MESSHALL_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  await Promise.all(clients.map(client => client.close().catch(() => {})));
  await daemon?.close();
  daemon = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

async function start() {
  const started = await startDaemon({ dataDir: home, now, port: 0 });
  if (!started.ok) throw new Error(`daemon did not start: ${started.reason}`);
  daemon = started.daemon;
  return started.daemon;
}

const agentKey = () => readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();

async function agent(url: string, key = agentKey()) {
  const connected = await connectHttp({ key, url });
  clients.push(connected.client);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await connected.client.callTool({ arguments: args, name });
    return { isError: Boolean(result.isError), text: textOf(result) };
  };
  return { ...connected, call };
}

const initialize = (protocolVersion: string) => ({
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: { capabilities: {}, clientInfo: { name: 'probe', version: '0' }, protocolVersion },
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${url}/mcp`, {
    body: JSON.stringify(body),
    headers: { accept: INIT_ACCEPT, 'content-type': 'application/json', [KEY_HEADER]: agentKey(), ...headers },
    method: 'POST',
  });
}

describe('the /mcp endpoint', () => {
  it('negotiates 2025-11-25 with the v2 client', async () => {
    const { url } = await start();

    const { client } = await agent(url);

    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
  });

  it('answers a sessionless server/discover with 400, so Claude Code falls back to initialize', async () => {
    const { url } = await start();

    const res = await post(url, { id: 1, jsonrpc: '2.0', method: 'server/discover', params: {} });

    expect(res.status).toBe(400);
  });

  it('refuses a request without the agent key with 401', async () => {
    const { url } = await start();

    const res = await post(url, initialize('2025-11-25'), { [KEY_HEADER]: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('refuses a request with a browser origin with 403', async () => {
    const { url } = await start();

    const res = await post(url, initialize('2025-11-25'), { origin: 'https://evil.example' });

    expect(res.status).toBe(403);
  });

  it('answers an unknown session id with 404', async () => {
    const { url } = await start();

    const res = await post(url, { id: 2, jsonrpc: '2.0', method: 'tools/list' }, { 'mcp-session-id': 'nope' });

    expect(res.status).toBe(404);
  });

  it('resolves a pending wait in one session when another session posts', async () => {
    const { url } = await start();
    const api = await agent(url);
    const web = await agent(url);
    await api.call('join', { as: 'api', room: 'checkout' });
    await web.call('join', { as: 'web', room: 'checkout' });
    await web.call('read_since', { room: 'checkout' });

    const waiting = web.call('wait', { room: 'checkout', timeout_s: 30 });
    await vi.waitFor(() => {
      expect(daemon?.sessionsFor({ name: 'web', room: 'checkout' })[0]?.session.open).toBeGreaterThan(1);
    });
    await api.call('post', { room: 'checkout', text: '@web total is cents now' });

    await expect(waiting).resolves.toStrictEqual({
      isError: false,
      text: '1 new since your last read in #checkout (api mentioned you). Call read_since.',
    });
    expect((await web.call('read_since', { room: 'checkout' })).text).toContain('api → @web] @web total is cents now');
  });

  it('maps a joined name to its session for the doorbell', async () => {
    const { url } = await start();
    const api = await agent(url);

    await api.call('join', { as: 'api', room: 'checkout' });

    const found = daemon!.sessionsFor({ name: 'api', room: 'checkout' });
    expect(found.map(entry => entry.session.id)).toStrictEqual([api.transport.sessionId]);
  });

  it('marks the members gone and forgets the session on DELETE', async () => {
    const { url } = await start();
    const api = await agent(url);
    await api.call('join', { as: 'api', room: 'checkout' });
    const sessionId = api.transport.sessionId!;

    await api.transport.terminateSession();

    expect(daemon!.sessionsFor({ name: 'api', room: 'checkout' })).toStrictEqual([]);
    const side = openDb({ dataDir: home });
    const member = createRoomStore({ db: side, now })
      .listMembers('checkout')
      .find(item => item.name === 'api');
    side.close();
    expect(member?.presence).toBe('gone');
    const res = await post(url, { id: 3, jsonrpc: '2.0', method: 'tools/list' }, { 'mcp-session-id': sessionId });
    expect(res.status).toBe(404);
  });
});

describe('createMcpEndpoint sweep', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>(resolve => {
      server?.closeAllConnections();
      server?.close(() => resolve());
    });
    server = undefined;
  });

  it('closes a session with no open request for 30 minutes and marks its members gone', async () => {
    const db = openDb({ dataDir: home });
    const store = createRoomStore({ db, now });
    const endpoint = createMcpEndpoint({ codex: fakeCodexRpc(), now, store });
    server = createServer((req, res) => {
      endpoint.handle(req, res)?.catch(() => {});
    });
    await new Promise<void>(resolve => {
      server!.listen(0, DAEMON_HOST, resolve);
    });
    const address = server.address();
    const url = `http://${DAEMON_HOST}:${typeof address === 'object' && address ? address.port : 0}`;
    const api = await agent(url, 'no-key-check-here');
    await api.call('join', { as: 'api', room: 'checkout' });
    at += SESSION_IDLE_MS;
    const held = await endpoint.sweep();
    await api.client.close();
    await vi.waitFor(() => expect(endpoint.sessionsFor({ name: 'api', room: 'checkout' })[0]?.session.open).toBe(0));

    at += SESSION_IDLE_MS - 1;
    const early = await endpoint.sweep();
    at += 1;
    const swept = await endpoint.sweep();

    expect([held, early, swept]).toStrictEqual([0, 0, 1]);
    expect(endpoint.sessionsFor({ name: 'api', room: 'checkout' })).toStrictEqual([]);
    expect(store.listMembers('checkout').find(member => member.name === 'api')?.presence).toBe('gone');
    db.close();
  });
});
