import type { McpServer } from '@modelcontextprotocol/server';

import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { CLI_VERSION } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

/** Links a server to a client in the same process. With `roots`, the client answers roots/list with them. */
export async function connectInMemory(createServer: () => McpServer, { roots }: { roots?: string[] } = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'messhall-in-memory', version: CLI_VERSION },
    roots ? { capabilities: { roots: {} } } : {},
  );
  if (roots) client.setRequestHandler('roots/list', () => ({ roots: roots.map(uri => ({ uri })) }));
  await createServer().connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** A client on the daemon's `/mcp` over real HTTP, sending the agent key. */
export async function connectHttp({ key, name = 'messhall-http', url }: { key: string; name?: string; url: string }) {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', url), {
    requestInit: { headers: { [KEY_HEADER]: key } },
  });
  const client = new Client({ name, version: CLI_VERSION });
  await client.connect(transport);
  return { client, transport };
}
