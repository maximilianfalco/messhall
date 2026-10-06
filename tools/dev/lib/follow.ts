import type { Client } from '@modelcontextprotocol/client';

import { execFileSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

import { callTool, lostSession, type ToolReply } from '../../../src/mcp/oneshot.js';
import { NOTHING_YET } from '../../../src/mcp/tools/wait.js';

const MORE = 'more are waiting';
const FENCE = /^`{3,}$/;

/** The message lines of a read_since reply, without the fences and the framing lines around them. */
export function messageLines(text: string) {
  let inside = false;
  return text.split('\n').filter(line => {
    if (FENCE.test(line)) {
      inside = !inside;
      return false;
    }
    return inside;
  });
}

/**
 * Calls `onLine` for each line written to the named pipe at `path`, made if missing.
 * We open it read and write, so a writer closing never ends the stream.
 */
function readFifo({ onLine, path }: { onLine: (line: string) => void; path: string }) {
  if (!existsSync(path)) execFileSync('mkfifo', [path]);
  const fd = openSync(path, 'r+');
  const socket = new Socket({ fd, readable: true, writable: false });
  createInterface({ input: socket }).on('line', line => {
    if (line.trim()) onLine(line);
  });
  return () => socket.destroy();
}

const BACKOFF_MS = [2000, 5000, 10_000, 15_000];

/** How long to wait before reconnect try `attempt`: 2, 5 and 10 s, then every 15 s. */
export const backoffMs = (attempt: number) => BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;

const sleep = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }).catch(() => {});

/**
 * Holds one seat until `signal` aborts: loops wait, writes each new message line, and posts each fifo line.
 * When the daemon drops the session or goes down, it waits with backoff and calls `rejoin` for a new
 * session, forever. Returns the client in use at the end and the error text when a call is refused.
 */
export async function follow({
  client: first,
  now = Date.now,
  pause = sleep,
  postFifo,
  rejoin,
  room,
  signal,
  write,
}: {
  client: Client;
  now?: () => number;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
  postFifo?: string;
  rejoin: () => Promise<Client>;
  room: string;
  signal: AbortSignal;
  write: (line: string) => void;
}) {
  let client = first;
  let lost = new AbortController();
  // A dead daemon leaves the open wait hanging, so a stream error has to cut it short.
  const use = (next: Client) => {
    const gone = new AbortController();
    client = next;
    lost = gone;
    client.onerror = error => {
      if (lostSession(error)) gone.abort();
    };
  };
  use(first);

  let reconnecting: Promise<boolean> | undefined;
  const tryAgain = async (started: number, attempt: number): Promise<boolean> => {
    await pause(backoffMs(attempt), signal);
    if (signal.aborted) return false;
    const next = await rejoin().catch(() => {});
    if (!next) return tryAgain(started, attempt + 1);
    use(next);
    write(`reconnected after ${Math.round((now() - started) / 1000)} s\n`);
    return true;
  };
  const reconnect = () => {
    reconnecting ??= tryAgain(now(), 0).finally(() => {
      reconnecting = undefined;
    });
    return reconnecting;
  };

  const call = async (name: string, args: Record<string, unknown>): Promise<ToolReply | undefined> => {
    if (signal.aborted) return undefined;
    const gone = lost.signal;
    const reply = await callTool(client, name, args, { signal: AbortSignal.any([signal, gone]) }).catch(
      (error: unknown) => {
        if (!signal.aborted && !gone.aborted && !lostSession(error)) throw error;
      },
    );
    if (reply) return reply;
    return !signal.aborted && (await reconnect()) ? call(name, args) : undefined;
  };

  let posts = Promise.resolve();
  const stopFifo = postFifo
    ? readFifo({
        onLine: text => {
          posts = posts
            .then(async () => {
              const posted = await call('post', { room, text });
              if (posted?.isError) write(`post refused: ${posted.text}\n`);
            })
            .catch((error: unknown) => write(`post failed: ${String(error)}\n`));
        },
        path: postFifo,
      })
    : undefined;
  const drain = async (): Promise<string | undefined> => {
    const read = await call('read_since', { room });
    if (!read) return undefined;
    if (read.isError) return read.text;
    messageLines(read.text).forEach(line => write(`${line}\n`));
    return read.text.includes(MORE) ? drain() : undefined;
  };
  const round = async (): Promise<string | undefined> => {
    const waited = await call('wait', { room });
    if (!waited) return undefined;
    if (waited.isError) return waited.text;
    const refused = waited.text === NOTHING_YET ? undefined : await drain();
    return refused ?? round();
  };
  try {
    const refused = await round().catch((error: unknown) => String(error));
    return { client, refused };
  } finally {
    stopFifo?.();
    await posts;
  }
}
