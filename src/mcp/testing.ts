import type { ToolDeps } from './tools/registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { CLI_VERSION } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

import { SEAT_HEADER } from './constants.js';

/** Links a server to a client in the same process. With `roots`, the client answers roots/list with them. */
export async function connectInMemory(
  createServer: () => McpServer,
  {
    name = 'messhall-in-memory',
    roots,
    version = CLI_VERSION,
  }: { name?: string; roots?: string[]; version?: string } = {},
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name, version }, roots ? { capabilities: { roots: {} } } : {});
  if (roots) client.setRequestHandler('roots/list', () => ({ roots: roots.map(uri => ({ uri })) }));
  await createServer().connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** A client on the daemon's `/mcp` over real HTTP, sending the agent key, and the seat key when given. */
export async function connectHttp({
  key,
  name = 'messhall-http',
  seat,
  url,
}: {
  key: string;
  name?: string;
  seat?: string;
  url: string;
}) {
  const headers = { [KEY_HEADER]: key, ...(seat ? { [SEAT_HEADER]: seat } : {}) };
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', url), { requestInit: { headers } });
  const client = new Client({ name, version: CLI_VERSION });
  await client.connect(transport);
  return { client, transport };
}

/** A spawner for an in-memory server on a scratch store: it starts nothing and says so. */
export const scratchSpawner: ToolDeps['spawner'] = {
  spawn: async () => ({ detail: 'a scratch server starts no agents', ok: false, reason: 'tmux' }) as const,
};
