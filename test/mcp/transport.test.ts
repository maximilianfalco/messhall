import type { Daemon } from '../../src/daemon/server.js';
import type { Client } from '@modelcontextprotocol/client';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AWAY_AFTER_MS, DAEMON_HOST, SESSION_DEAD_MS } from '../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { CHANNEL_METHOD } from '../../src/doorbell/ringers/channel.js';
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

async function start(sweepEveryMs?: number) {
  const started = await startDaemon({ dataDir: home, now, port: 0, sweepEveryMs });
  if (!started.ok) throw new Error(`daemon did not start: ${started.reason}`);
  daemon = started.daemon;
  return started.daemon;
}

const agentKey = () => readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();

async function agent(url: string, key = agentKey(), seat?: string) {
  const connected = await connectHttp({ key, seat, url });
  clients.push(connected.client);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await connected.client.callTool({ arguments: args, name });
    return { isError: Boolean(result.isError), text: textOf(result) };
  };
  return { ...connected, call };
}

function ringsOf(client: Client) {
  const rings: { content: string; meta: Record<string, string> }[] = [];
  client.setNotificationHandler(
    CHANNEL_METHOD,
    { params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) },
    params => {
      rings.push(params);
    },
  );
  return rings;
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

  it('shows a quiet seat its doorbell can reach as idle and one it cannot reach as away', async () => {
    const { url } = await start(10);
    const api = await agent(url);
    const web = await agent(url);
    const outsider = await agent(url);
    const rings = ringsOf(api.client);
    await api.call('join', { as: 'api', kind: 'claude', room: 'checkout' });
    await web.call('join', { as: 'web', kind: 'other', room: 'checkout' });
    await vi.waitFor(() => expect(rings).toHaveLength(1));
    await api.call('doorbell_ok', { id: rings[0]!.meta.doorbell_check });

    at += AWAY_AFTER_MS;

    await vi.waitFor(async () => {
      const members = (await outsider.call('list_members', { room: 'checkout' })).text;
      expect(members).toContain('- api (messhall-http 0.1.0, idle)');
      expect(members).toContain('- web (messhall-http 0.1.0, away)');
    });
  });

  it('shows a quiet claude that never answered its doorbell check as away with no doorbell', async () => {
    const { url } = await start(10);
    const api = await agent(url);
    const outsider = await agent(url);
    await api.call('join', { as: 'api', kind: 'claude', room: 'checkout' });

    at += AWAY_AFTER_MS;

    await vi.waitFor(async () => {
      const members = (await outsider.call('list_members', { room: 'checkout' })).text;
      expect(members).toContain('- api (messhall-http 0.1.0 (no doorbell), away)');
    });
  });

  it('seats a client that comes back with its seat header after a restart, with its role, and no join', async () => {
    const first = await start();
    const api = await agent(first.url, agentKey(), 'seat-a');
    const orchestrator = await agent(first.url);
    await api.call('join', { as: 'api', room: 'checkout' });
    await orchestrator.call('join', { as: 'orchestrator', room: 'checkout' });
    await orchestrator.call('assign_role', { member: 'api', role: 'worker', room: 'checkout' });
    await first.close();
    daemon = undefined;
    const second = await start();

    const back = await agent(second.url, agentKey(), 'seat-a');
    const posted = await back.call('post', { room: 'checkout', text: 'back after the restart' });
    const role = await back.call('my_role', { room: 'checkout' });

    expect(posted.isError).toBe(false);
    expect(role.text).toContain('your role in #checkout: worker');
    expect(second.sessionsFor({ name: 'api', room: 'checkout' })).toHaveLength(1);
  });

  it('seats whichever session calls first when a reconnect opens sibling sessions with one seat header', async () => {
    const first = await start();
    const api = await agent(first.url, agentKey(), 'seat-a');
    await api.call('join', { as: 'api', room: 'checkout' });
    await first.close();
    daemon = undefined;
    const second = await start();

    const early = await agent(second.url, agentKey(), 'seat-a');
    const late = await agent(second.url, agentKey(), 'seat-a');
    const posted = await late.call('post', { room: 'checkout', text: 'back after the restart' });
    const earlyRead = await early.call('read_since', { room: 'checkout' });

    expect(posted.isError).toBe(false);
    expect(earlyRead).toStrictEqual({ isError: true, text: 'you are not in #checkout. call join first.' });
    expect(second.sessionsFor({ name: 'api', room: 'checkout' }).map(entry => entry.session.id)).toStrictEqual([
      late.transport.sessionId,
    ]);
  });

  it('keeps the done mark when a seat comes back after a restart', async () => {
    const first = await start();
    const api = await agent(first.url, agentKey(), 'seat-a');
    const web = await agent(first.url);
    await api.call('join', { as: 'api', room: 'checkout' });
    await web.call('join', { as: 'web', room: 'checkout' });
    await api.call('post', { done: true, room: 'checkout', text: 'my part is in' });
    await first.close();
    daemon = undefined;
    const second = await start();

    const back = await agent(second.url, agentKey(), 'seat-a');
    const members = await back.call('list_members', { room: 'checkout' });

    expect(members.text).toMatch(/api \([^)]*done/);
  });

  it('seats an invited agent on its first call with its role, so it posts with no join', async () => {
    const { url } = await start();
    const side = createRoomStore({ db: openDb({ dataDir: home }), now });
    side.createRoom({ created_by: 'human', name: 'checkout' });
    const made = side.invite({
      by: 'human',
      instructions: 'build the api',
      launch: { agent: 'claude', cwd: home },
      name: 'api',
      role: 'worker',
      room: 'checkout',
    });
    if (!made.ok) throw new Error(made.reason);

    const api = await agent(url, agentKey(), made.seatKey);
    const posted = await api.call('post', { room: 'checkout', text: 'here' });
    const role = await api.call('my_role', { room: 'checkout' });

    expect(posted.isError).toBe(false);
    expect(role.text).toContain('your role in #checkout: worker');
    expect(role.text).toContain('build the api');
    expect(side.listMembers('checkout').find(member => member.name === 'api')?.presence).toBe('active');
  });

  it('leaves a live seat with its holder when a second session sends the same seat header', async () => {
    const { url } = await start();
    const parent = await agent(url, agentKey(), 'seat-a');
    await parent.call('join', { as: 'api', room: 'checkout' });

    const child = await agent(url, agentKey(), 'seat-a');
    const childPost = await child.call('post', { room: 'checkout', text: 'from the child' });
    const parentPost = await parent.call('post', { room: 'checkout', text: 'still mine' });

    expect(childPost).toStrictEqual({ isError: true, text: 'you are not in #checkout. call join first.' });
    expect(parentPost.isError).toBe(false);
    expect(daemon!.sessionsFor({ name: 'api', room: 'checkout' }).map(entry => entry.session.id)).toStrictEqual([
      parent.transport.sessionId,
    ]);
  });

  it('leaves an away seat alone for a client with another seat header', async () => {
    const first = await start();
    const api = await agent(first.url, agentKey(), 'seat-a');
    await api.call('join', { as: 'api', room: 'checkout' });
    await api.transport.terminateSession();

    const other = await agent(first.url, agentKey(), 'seat-b');
    const posted = await other.call('post', { room: 'checkout', text: 'hi' });
    const joined = await other.call('join', { as: 'api', room: 'checkout' });

    expect(posted).toStrictEqual({ isError: true, text: 'you are not in #checkout. call join first.' });
    expect(joined).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
  });

  it('seats a hand-started claude again with its role after its session closes, by the seat token from its join', async () => {
    const { url } = await start();
    const first = await connectHttp({ key: agentKey(), name: 'claude-code', url });
    clients.push(first.client);
    const orchestrator = await agent(url);
    const joined = await first.client.callTool({ arguments: { as: 'api', room: 'checkout' }, name: 'join' });
    const token = /seat token: (tok-[0-9a-f-]{36})\./.exec(textOf(joined))?.[1];
    await orchestrator.call('join', { as: 'orchestrator', room: 'checkout' });
    await orchestrator.call('assign_role', { member: 'api', role: 'worker', room: 'checkout' });
    await first.transport.terminateSession();
    const back = await connectHttp({ key: agentKey(), name: 'claude-code', url });
    clients.push(back.client);
    const stranger = await agent(url);

    const taken = await stranger.call('join', { as: 'api', room: 'checkout' });
    const rejoined = await back.client.callTool({
      arguments: { as: 'api', room: 'checkout', seat_token: token },
      name: 'join',
    });
    const role = await back.client.callTool({ arguments: { room: 'checkout' }, name: 'my_role' });

    expect(taken).toStrictEqual({ isError: true, text: 'name taken, try api-2.' });
    expect(textOf(rejoined)).toContain('reconnected #checkout as api');
    expect(textOf(role)).toContain('your role in #checkout: worker');
  });

  it('marks the members away and forgets the session on DELETE', async () => {
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
    expect(member?.presence).toBe('away');
    const res = await post(url, { id: 3, jsonrpc: '2.0', method: 'tools/list' }, { 'mcp-session-id': sessionId });
    expect(res.status).toBe(404);
  });
});

describe('createMcpEndpoint sweep', () => {
  let server: Server | undefined;
  let store: ReturnType<typeof createRoomStore>;
  let endpoint: ReturnType<typeof createMcpEndpoint>;
  let closeDb: () => void;

  beforeEach(async () => {
    const db = openDb({ dataDir: home });
    closeDb = () => db.close();
    store = createRoomStore({ db, now });
    endpoint = createMcpEndpoint({ codex: fakeCodexRpc(), now, store });
    server = createServer((req, res) => {
      endpoint.handle(req, res)?.catch(() => {});
    });
    await new Promise<void>(resolve => {
      server!.listen(0, DAEMON_HOST, resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>(resolve => {
      server?.closeAllConnections();
      server?.close(() => resolve());
    });
    server = undefined;
    closeDb();
  });

  const endpointUrl = () => {
    const address = server!.address();
    return `http://${DAEMON_HOST}:${typeof address === 'object' && address ? address.port : 0}`;
  };
  const sessionOf = (name: string) => endpoint.sessionsFor({ name, room: 'checkout' })[0]?.session;
  const presenceOf = (name: string) => store.listMembers('checkout').find(member => member.name === name)?.presence;

  async function rawSession() {
    const url = endpointUrl();
    const send = (body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
      fetch(`${url}/mcp`, {
        body: JSON.stringify(body),
        headers: { accept: INIT_ACCEPT, 'content-type': 'application/json', ...headers },
        method: 'POST',
        signal,
      });
    const init = await send(initialize('2025-11-25'));
    await init.text();
    const session = { 'mcp-session-id': init.headers.get('mcp-session-id')! };
    const call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
      send({ id: 2, jsonrpc: '2.0', method: 'tools/call', params: { arguments: args, name } }, session, signal);
    await (await call('join', { as: 'api', room: 'checkout' })).text();
    return { call };
  }

  it('closes a session with no stream and no call for 60 s at the next sweep and marks its members away', async () => {
    const api = await agent(endpointUrl(), 'no-key-check-here');
    await api.call('join', { as: 'api', room: 'checkout' });
    await api.client.close();
    await vi.waitFor(() => expect(sessionOf('api')?.open).toBe(0));

    at += SESSION_DEAD_MS - 1;
    const early = await endpoint.sweep();
    at += 1;
    const swept = await endpoint.sweep();

    expect([early, swept]).toStrictEqual([0, 1]);
    expect(sessionOf('api')).toBeUndefined();
    expect(presenceOf('api')).toBe('away');
  });

  it('calls a seat ringable only while a live session can ring it', async () => {
    const api = await agent(endpointUrl(), 'no-key-check-here');
    const web = await agent(endpointUrl(), 'no-key-check-here');
    await api.call('join', { as: 'api', kind: 'claude', room: 'checkout' });
    await web.call('join', { as: 'web', kind: 'other', room: 'checkout' });
    const before = ['api', 'web'].map(name => endpoint.ringable({ name, room: 'checkout' }));

    await api.client.close();
    await vi.waitFor(() => expect(sessionOf('api')?.open).toBe(0));
    at += SESSION_DEAD_MS;
    await endpoint.sweep();

    expect(before).toStrictEqual([true, false]);
    expect(endpoint.ringable({ name: 'api', room: 'checkout' })).toBe(false);
  });

  it('keeps a session whose stream is open however long it is quiet', async () => {
    const api = await agent(endpointUrl(), 'no-key-check-here');
    await api.call('join', { as: 'api', room: 'checkout' });
    await vi.waitFor(() => expect(sessionOf('api')?.open).toBeGreaterThan(0));

    at += 10 * SESSION_DEAD_MS;

    await expect(endpoint.sweep()).resolves.toBe(0);
    expect(presenceOf('api')).toBe('active');
  });

  it('keeps a session with no stream alive while a wait is in flight, then sweeps it once the caller dies', async () => {
    const api = await rawSession();
    const abort = new AbortController();
    const waiting = api.call('wait', { room: 'checkout', timeout_s: 270 }, abort.signal).catch(() => {});
    await vi.waitFor(() => expect(presenceOf('api')).toBe('waiting'));

    at += 3 * SESSION_DEAD_MS;
    const held = await endpoint.sweep();
    abort.abort();
    await waiting;
    await vi.waitFor(() => expect(sessionOf('api')?.open).toBe(0));
    at += SESSION_DEAD_MS;
    const swept = await endpoint.sweep();

    expect([held, swept]).toStrictEqual([0, 1]);
    expect(presenceOf('api')).toBe('away');
  });
});
