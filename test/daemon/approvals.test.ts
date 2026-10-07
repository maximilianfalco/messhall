import type { Daemon } from '../../src/daemon/server.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { approvalResultSchema, snapshotSchema } from '../../contracts/feed.ts';
import { APPROVAL_TTL_MS, SWEEP_EVERY_MS } from '../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { PERMISSION_METHOD, PERMISSION_REQUEST_METHOD } from '../../src/mcp/permission.js';
import { connectHttp } from '../../src/mcp/testing.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const ASK = {
  description: 'Run the tests',
  input_preview: '{"command": "pnpm test"}',
  request_id: 'abcde',
  tool_name: 'Bash',
};

let home: string;
let at: number;
let daemon: Daemon | undefined;
const closers: (() => Promise<void>)[] = [];
const now = () => new Date(at);

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-approvals-'));
  at = T0;
  vi.stubEnv('MESSHALL_HOME', home);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()));
  await daemon?.close();
  daemon = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { force: true, recursive: true });
});

const keyOf = (kind: keyof typeof KEY_FILES) => readFileSync(path.join(home, KEY_FILES[kind]), 'utf8');

async function start() {
  const started = await startDaemon({ dataDir: home, now, port: 0 });
  if (!started.ok) throw new Error(`daemon did not start: ${started.reason}`);
  daemon = started.daemon;
  return started.daemon;
}

async function snapshot(url: string) {
  const res = await fetch(`${url}/api/snapshot`, { headers: { [KEY_HEADER]: keyOf('human') } });
  return snapshotSchema.parse(await res.json());
}

async function askingClaude(url: string) {
  const { client, transport } = await connectHttp({ key: keyOf('agent'), name: 'claude-code', url });
  closers.push(() => client.close());
  const verdicts: unknown[] = [];
  client.setNotificationHandler(
    PERMISSION_METHOD,
    { params: z.object({ behavior: z.string(), request_id: z.string() }) },
    params => {
      verdicts.push(params);
    },
  );
  await client.callTool({ arguments: { as: 'api', room: 'demo' }, name: 'join' });
  await client.notification({ method: PERMISSION_REQUEST_METHOD, params: ASK });
  const pending = await vi.waitFor(async () => {
    const [approval] = (await snapshot(url)).rooms[0]!.approvals;
    if (!approval) throw new Error('no approval yet');
    return approval;
  });
  return { client, pending, transport, verdicts };
}

const answer = (url: string, id: string, body: unknown, key = keyOf('human')) =>
  fetch(`${url}/api/approvals/${id}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
    method: 'POST',
  });

describe('POST /api/approvals/:id', () => {
  it('relays the human allow to the agent that asked, with its own request id', async () => {
    const { url } = await start();
    const { pending, verdicts } = await askingClaude(url);

    const res = await answer(url, pending.id, { behavior: 'allow' });

    expect(res.status).toBe(200);
    expect(approvalResultSchema.parse(await res.json()).approvals.map(row => row.state)).toStrictEqual(['allowed']);
    await vi.waitFor(() => {
      expect(verdicts).toStrictEqual([{ behavior: 'allow', request_id: 'abcde' }]);
    });
    expect((await snapshot(url)).rooms[0]!.approvals).toStrictEqual([]);
  });

  it('relays a deny', async () => {
    const { url } = await start();
    const { pending, verdicts } = await askingClaude(url);

    await answer(url, pending.id, { behavior: 'deny' });

    await vi.waitFor(() => {
      expect(verdicts).toStrictEqual([{ behavior: 'deny', request_id: 'abcde' }]);
    });
  });

  it('refuses the agent key with 403 and leaves the ask pending', async () => {
    const { url } = await start();
    const { pending, verdicts } = await askingClaude(url);

    const res = await answer(url, pending.id, { behavior: 'allow' }, keyOf('agent'));

    expect(res.status).toBe(403);
    expect((await snapshot(url)).rooms[0]!.approvals.map(row => row.id)).toStrictEqual([pending.id]);
    expect(verdicts).toStrictEqual([]);
  });

  it('refuses an id it never issued, the client request id too, with 404', async () => {
    const { url } = await start();
    const { verdicts } = await askingClaude(url);

    const res = await answer(url, 'abcde', { behavior: 'allow' });

    expect(res.status).toBe(404);
    expect((await snapshot(url)).rooms[0]!.approvals).toHaveLength(1);
    expect(verdicts).toStrictEqual([]);
  });

  it('refuses a second answer to the same id with 404', async () => {
    const { url } = await start();
    const { pending } = await askingClaude(url);
    await answer(url, pending.id, { behavior: 'deny' });

    const res = await answer(url, pending.id, { behavior: 'allow' });

    expect(res.status).toBe(404);
  });

  it('refuses a body with no allow or deny with 400 and leaves the ask pending', async () => {
    const { url } = await start();
    const { pending } = await askingClaude(url);

    const res = await answer(url, pending.id, { behavior: 'yes' });

    expect(res.status).toBe(400);
    expect((await snapshot(url)).rooms[0]!.approvals).toHaveLength(1);
  });

  it('expires the ask when the session that asked ends, so a late answer finds nothing', async () => {
    const { url } = await start();
    const { pending, transport } = await askingClaude(url);
    await transport.terminateSession();

    const res = await answer(url, pending.id, { behavior: 'allow' });

    expect(res.status).toBe(404);
    expect((await snapshot(url)).rooms[0]!.approvals).toStrictEqual([]);
  });
});

describe('expiry', () => {
  it('denies an ask nobody answered in time on the next sweep', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { url } = await start();
    const { verdicts } = await askingClaude(url);

    at += APPROVAL_TTL_MS;
    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    await vi.waitFor(() => {
      expect(verdicts).toStrictEqual([{ behavior: 'deny', request_id: 'abcde' }]);
    });
    expect((await snapshot(url)).rooms[0]!.approvals).toStrictEqual([]);
  });
});
