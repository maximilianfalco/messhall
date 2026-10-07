import type { Daemon } from '../../src/daemon/server.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { TOOL_NAMES } from '../../src/mcp/constants.js';

let home: string;
let daemon: Daemon | undefined;
let client: Client | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-protocol-'));
  vi.stubEnv('MESSHALL_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  await client?.close().catch(() => {});
  client = undefined;
  await daemon?.close();
  daemon = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

async function start() {
  const started = await startDaemon({ dataDir: home, now: () => new Date(), port: 0 });
  if (!started.ok) throw new Error(`daemon did not start: ${started.reason}`);
  daemon = started.daemon;
  return started.daemon.url;
}

const agentKey = () => readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();

async function initialize(url: string, protocolVersion: string, clientName = 'probe') {
  const res = await fetch(`${url}/mcp`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: { capabilities: {}, clientInfo: { name: clientName, version: '0' }, protocolVersion },
    }),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      [KEY_HEADER]: agentKey(),
    },
    method: 'POST',
  });
  const data = (await res.text()).split('\n').find(line => line.startsWith('data: '))!;
  return JSON.parse(data.slice('data: '.length)) as {
    result: { capabilities: { experimental?: Record<string, unknown> }; protocolVersion: string };
  };
}

async function pinnedClient(url: string, version: string) {
  client = new Client({ name: 'pinned', version: '0' }, { supportedProtocolVersions: [version] });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', url), {
      requestInit: { headers: { [KEY_HEADER]: agentKey() } },
    }),
  );
  return client;
}

describe('protocol negotiation on /mcp', () => {
  it.each([
    ['2025-03-26', '2025-03-26'],
    ['2025-06-18', '2025-06-18'],
    ['2025-11-25', '2025-11-25'],
    ['2026-07-28', '2025-11-25'],
  ])('answers a client asking %s with %s', async (asked, answered) => {
    const url = await start();

    const { result } = await initialize(url, asked);

    expect(result.protocolVersion).toBe(answered);
  });

  it.each(['2025-03-26', '2025-06-18', '2025-11-25'])('declares the channel capability on %s', async asked => {
    const url = await start();

    const { result } = await initialize(url, asked);

    expect(result.capabilities.experimental).toStrictEqual({ 'claude/channel': {}, 'claude/channel/permission': {} });
  });

  it('keeps Claude Code on 2025-11-25 with the channel', async () => {
    const url = await start();

    const { result } = await initialize(url, '2025-11-25', 'claude-code');

    expect(result.protocolVersion).toBe('2025-11-25');
    expect(result.capabilities.experimental).toStrictEqual({ 'claude/channel': {}, 'claude/channel/permission': {} });
  });

  it.each(['2025-03-26', '2025-06-18'])(
    'lets an sdk client pinned to %s list the seven tools and join',
    async version => {
      const url = await start();

      const pinned = await pinnedClient(url, version);
      const { tools } = await pinned.listTools();
      const joined = await pinned.callTool({ arguments: { as: 'gemini', room: 'checkout' }, name: 'join' });

      expect(pinned.getNegotiatedProtocolVersion()).toBe(version);
      expect(tools.map(tool => tool.name)).toStrictEqual([...TOOL_NAMES]);
      expect(Boolean(joined.isError)).toBe(false);
    },
  );
});
