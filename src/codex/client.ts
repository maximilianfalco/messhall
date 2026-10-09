import type { SetTimer } from '../doorbell/batch.js';
import type { InitializeParams } from './generated/InitializeParams.js';
import type { InitializeResponse } from './generated/InitializeResponse.js';
import type { ListMcpServerStatusParams } from './generated/v2/ListMcpServerStatusParams.js';
import type { ThreadArchiveParams } from './generated/v2/ThreadArchiveParams.js';
import type { ThreadInjectItemsParams } from './generated/v2/ThreadInjectItemsParams.js';
import type { ThreadLoadedListParams } from './generated/v2/ThreadLoadedListParams.js';
import type { ThreadLoadedListResponse } from './generated/v2/ThreadLoadedListResponse.js';
import type { ThreadQueueAddParams } from './generated/v2/ThreadQueueAddParams.js';
import type { ThreadQueueAddResponse } from './generated/v2/ThreadQueueAddResponse.js';
import type { ThreadReadParams } from './generated/v2/ThreadReadParams.js';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams.js';
import type { ThreadStatus } from './generated/v2/ThreadStatus.js';

import { type RawData, WebSocket } from 'ws';

import { CLI_VERSION, CODEX_RECONNECT_MAX_MS, CODEX_RECONNECT_MIN_MS, CODEX_REQUEST_TIMEOUT_MS } from '../config.js';
import { realTimer } from '../doorbell/batch.js';

// The full Thread type pulls in 70 generated files, so replies name only the fields we read.
interface ThreadReply {
  thread: { cwd: string; id: string; status: ThreadStatus };
}

interface Methods {
  initialize: { params: InitializeParams; result: InitializeResponse };
  'mcpServerStatus/list': {
    params: ListMcpServerStatusParams;
    result: { data: { name: string; runtimeStatus?: string }[] };
  };
  'thread/archive': { params: ThreadArchiveParams; result: Record<string, never> };
  'thread/inject_items': { params: ThreadInjectItemsParams; result: Record<string, never> };
  'thread/loaded/list': { params: ThreadLoadedListParams; result: ThreadLoadedListResponse };
  'thread/queue/add': { params: ThreadQueueAddParams; result: ThreadQueueAddResponse };
  'thread/read': { params: ThreadReadParams; result: ThreadReply };
  'thread/start': { params: ThreadStartParams; result: ThreadReply };
}

export type CodexMethod = keyof Methods;

export type CodexResult<M extends CodexMethod> =
  | { error: string; ok: false }
  | { ok: true; result: Methods[M]['result'] };

type Reply = { error: string; ok: false } | { ok: true; result: unknown };

const INITIALIZE: InitializeParams = {
  capabilities: { experimentalApi: true, requestAttestation: false },
  clientInfo: { name: 'messhall', title: null, version: CLI_VERSION },
};

const CLOSED: Reply = { error: 'codex control socket closed', ok: false };

function errorText(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'codex error';
}

function parseReply(data: RawData) {
  try {
    const parsed: unknown = JSON.parse(String(data));
    if (typeof parsed !== 'object' || parsed === null || 'method' in parsed) return null;
    if (!('id' in parsed) || typeof parsed.id !== 'number') return null;
    const reply: Reply =
      'error' in parsed
        ? { error: errorText(parsed.error), ok: false }
        : { ok: true, result: 'result' in parsed ? parsed.result : undefined };
    return { id: parsed.id, reply };
  } catch {
    return null;
  }
}

/** JSON-RPC over WebSocket to Codex's shared control socket. Connects on first use,
 * reconnects with backoff after a close, and never throws. */
export function createCodexClient({ setTimer = realTimer, socketPath }: { setTimer?: SetTimer; socketPath: string }) {
  const pending = new Map<number, (reply: Reply) => void>();
  let nextId = 1;
  let current: Promise<WebSocket | null> | undefined;
  let backoff = CODEX_RECONNECT_MIN_MS;
  let stopRetry: (() => void) | undefined;
  let closed = false;

  function call(ws: WebSocket, method: string, params: unknown) {
    const id = nextId;
    nextId += 1;
    return new Promise<Reply>(resolve => {
      const stopTimeout = setTimer(
        () => pending.get(id)?.({ error: `codex did not answer ${method}`, ok: false }),
        CODEX_REQUEST_TIMEOUT_MS,
      );
      pending.set(id, reply => {
        stopTimeout();
        pending.delete(id);
        resolve(reply);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  function connect(): Promise<WebSocket | null> {
    const ws = new WebSocket(`ws+unix://${socketPath}:/`);
    ws.on('message', data => {
      const parsed = parseReply(data);
      if (parsed) pending.get(parsed.id)?.(parsed.reply);
    });
    // A close always follows an error, so the close handler cleans up.
    ws.on('error', () => {});
    return new Promise(resolve => {
      ws.once('open', async () => {
        const init = await call(ws, 'initialize', INITIALIZE);
        if (!init.ok) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ method: 'initialized', params: {} }));
        backoff = CODEX_RECONNECT_MIN_MS;
        resolve(ws);
      });
      ws.once('close', () => {
        current = undefined;
        [...pending.values()].forEach(settle => settle(CLOSED));
        resolve(null);
        if (closed || stopRetry) return;
        const ms = backoff;
        backoff = Math.min(backoff * 2, CODEX_RECONNECT_MAX_MS);
        stopRetry = setTimer(() => {
          stopRetry = undefined;
          if (!closed) current ??= connect();
        }, ms);
      });
    });
  }

  function connected() {
    if (closed) return Promise.resolve(null);
    current ??= connect();
    return current;
  }

  return {
    /** Stops reconnecting and closes the socket. Open requests fail. */
    close() {
      closed = true;
      stopRetry?.();
      current?.then(ws => ws?.close());
    },
    /** Sends one request once the socket is up and handshaken. Resolves to the result or the error text. */
    async request<M extends CodexMethod>(method: M, params: Methods[M]['params']): Promise<CodexResult<M>> {
      const ws = await connected();
      if (!ws) return { error: 'codex control socket is not reachable', ok: false };
      // The daemon's JSON is trusted to match the generated types for its version.
      return (await call(ws, method, params)) as CodexResult<M>;
    },
  };
}

export type CodexClient = ReturnType<typeof createCodexClient>;
