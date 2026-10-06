import type { Handler } from '../../src/daemon/router.js';
import type { Server } from 'node:http';

import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeyKind } from '../../src/daemon/keys.js';

import { KEY_FILES, KEY_HEADER, loadKeys } from '../../src/daemon/keys.js';

import { get } from './http.js';

let home: string;
let server: Server | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-keys-'));
});

afterEach(async () => {
  if (server) {
    const closing = server;
    await new Promise(resolve => {
      closing.close(resolve);
    });
  }
  server = undefined;
  rmSync(home, { force: true, recursive: true });
});

const keyFile = (kind: keyof typeof KEY_FILES) => path.join(home, KEY_FILES[kind]);
const readKey = (kind: keyof typeof KEY_FILES) => readFileSync(keyFile(kind), 'utf8');
const mode = (file: string) => statSync(file).mode % 0o1000;

async function agentRoute(kinds: KeyKind | KeyKind[] = 'agent') {
  const handler = vi.fn<Handler>((_req, res) => {
    res.end('in');
  });
  const keys = loadKeys({ dataDir: home });
  server = createServer(keys.requireKey(kinds, handler));
  const listening = server;
  await new Promise<void>(resolve => {
    listening.listen(0, '127.0.0.1', resolve);
  });
  const address = listening.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { handler, port };
}

describe('loadKeys', () => {
  it('creates both key files with mode 0600 on first load', () => {
    loadKeys({ dataDir: home });

    expect(readKey('agent')).toMatch(/^[0-9a-f]{64}$/);
    expect(readKey('human')).toMatch(/^[0-9a-f]{64}$/);
    expect(readKey('agent')).not.toBe(readKey('human'));
    expect(mode(keyFile('agent'))).toBe(0o600);
    expect(mode(keyFile('human'))).toBe(0o600);
  });

  it('reuses the files on the next load', () => {
    loadKeys({ dataDir: home });
    const first = [readKey('agent'), readKey('human')];

    loadKeys({ dataDir: home });

    expect([readKey('agent'), readKey('human')]).toStrictEqual(first);
  });

  it('tightens a key file that others can read back to 0600', () => {
    loadKeys({ dataDir: home });
    chmodSync(keyFile('human'), 0o644);

    loadKeys({ dataDir: home });

    expect(mode(keyFile('human'))).toBe(0o600);
  });

  it('refuses to start with an empty key file', () => {
    writeFileSync(keyFile('agent'), '', { mode: 0o600 });

    expect(() => loadKeys({ dataDir: home })).toThrow(/agent-key/);
  });
});

describe('requireKey', () => {
  it('refuses a request with no key and never runs the handler', async () => {
    const { handler, port } = await agentRoute();

    const res = await get({ path: '/', port });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['wrong', '0'.repeat(64)])('refuses the wrong key %s', async key => {
    const { handler, port } = await agentRoute();

    const res = await get({ headers: { [KEY_HEADER]: key }, path: '/', port });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses the human key on an agent route with 403', async () => {
    const { handler, port } = await agentRoute();

    const res = await get({ headers: { [KEY_HEADER]: readKey('human') }, path: '/', port });

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses the agent key on a human route with 403', async () => {
    const { handler, port } = await agentRoute('human');

    const res = await get({ headers: { [KEY_HEADER]: readKey('agent') }, path: '/', port });

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['agent', 'human'] as const)('lets the %s key through a route that takes either', async kind => {
    const { handler, port } = await agentRoute(['agent', 'human']);

    const res = await get({ headers: { [KEY_HEADER]: readKey(kind) }, path: '/', port });

    expect(res).toStrictEqual({ body: 'in', status: 200 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('refuses no key on a route that takes either with 401', async () => {
    const { handler, port } = await agentRoute(['agent', 'human']);

    const res = await get({ path: '/', port });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets the right key through to the handler', async () => {
    const { handler, port } = await agentRoute();

    const res = await get({ headers: { [KEY_HEADER]: readKey('agent') }, path: '/', port });

    expect(res).toStrictEqual({ body: 'in', status: 200 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
