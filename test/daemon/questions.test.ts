import type { Daemon } from '../../src/daemon/server.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { answerResultSchema, snapshotSchema } from '../../contracts/feed.ts';
import { QUESTION_TTL_MS, SWEEP_EVERY_MS } from '../../src/config.js';
import { KEY_FILES, KEY_HEADER } from '../../src/daemon/keys.js';
import { startDaemon } from '../../src/daemon/server.js';
import { connectHttp } from '../../src/mcp/testing.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');

let home: string;
let at: number;
let daemon: Daemon | undefined;
const closers: (() => Promise<void>)[] = [];
const now = () => new Date(at);

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'messhall-questions-'));
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

async function openQuestions(url: string) {
  const res = await fetch(`${url}/api/snapshot`, { headers: { [KEY_HEADER]: keyOf('human') } });
  return snapshotSchema.parse(await res.json()).rooms[0]!.questions;
}

const text = (result: Awaited<ReturnType<Awaited<ReturnType<typeof connectHttp>>['client']['callTool']>>) =>
  (result.content as { text: string }[]).map(item => item.text).join('\n');

async function askingAgent(url: string) {
  const { client } = await connectHttp({ key: keyOf('agent'), name: 'claude-code', url });
  closers.push(() => client.close());
  await client.callTool({ arguments: { as: 'api', room: 'demo' }, name: 'join' });
  await client.callTool({
    arguments: { options: ['ship it', 'wait'], question: 'merge now?', room: 'demo' },
    name: 'ask_human',
  });
  const [question] = await openQuestions(url);
  await client.callTool({ arguments: { room: 'demo' }, name: 'read_since' });
  return { client, question: question! };
}

const answer = (url: string, id: string, body: unknown, key = keyOf('human')) =>
  fetch(`${url}/api/questions/${id}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
    method: 'POST',
  });

describe('POST /api/questions/:id', () => {
  it('answers with a human line that the asker reads as a mention', async () => {
    const { url } = await start();
    const { client, question } = await askingAgent(url);

    const res = await answer(url, question.id, { option: 0 });

    expect(res.status).toBe(200);
    const result = answerResultSchema.parse(await res.json());
    expect(result.question).toMatchObject({ answer: 0, state: 'answered' });
    expect(result.message).toMatchObject({ from: 'human', mentions: ['api'] });
    const waited = await client.callTool({ arguments: { room: 'demo', timeout_s: 1 }, name: 'wait' });
    expect(text(waited)).toContain('1 new since your last read in #demo (human mentioned you)');
    const read = await client.callTool({ arguments: { room: 'demo' }, name: 'read_since' });
    expect(text(read)).toContain(`@api answer to your question #${question.message_id}: ship it`);
    await expect(openQuestions(url)).resolves.toStrictEqual([]);
  });

  it('refuses the agent key with 403 and leaves the question open', async () => {
    const { url } = await start();
    const { question } = await askingAgent(url);

    const res = await answer(url, question.id, { option: 0 }, keyOf('agent'));

    expect(res.status).toBe(403);
    expect((await openQuestions(url)).map(item => item.id)).toStrictEqual([question.id]);
  });

  it('refuses a second answer with 404', async () => {
    const { url } = await start();
    const { question } = await askingAgent(url);
    await answer(url, question.id, { option: 0 });

    const res = await answer(url, question.id, { option: 1 });

    expect(res.status).toBe(404);
  });

  it('refuses an id it never issued with 404', async () => {
    const { url } = await start();
    await askingAgent(url);

    const res = await answer(url, '00000000-0000-4000-8000-000000000000', { option: 0 });

    expect(res.status).toBe(404);
  });

  it.each([{ option: 2 }, { option: -1 }, { option: 'ship it' }, {}])(
    'refuses %j with 400 and leaves the question open',
    async body => {
      const { url } = await start();
      const { question } = await askingAgent(url);

      const res = await answer(url, question.id, body);

      expect(res.status).toBe(400);
      expect((await openQuestions(url)).map(item => item.id)).toStrictEqual([question.id]);
    },
  );
});

describe('question expiry', () => {
  it('closes a question nobody answered and rings the asker on the next sweep', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { url } = await start();
    const { client, question } = await askingAgent(url);

    at += QUESTION_TTL_MS;
    vi.advanceTimersByTime(SWEEP_EVERY_MS);

    await vi.waitFor(async () => {
      await expect(openQuestions(url)).resolves.toStrictEqual([]);
    });
    const read = await client.callTool({ arguments: { room: 'demo' }, name: 'read_since' });
    expect(text(read)).toContain(`@api no answer from the human to your question #${question.message_id}`);
  });
});
