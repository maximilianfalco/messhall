import type { Client } from '@modelcontextprotocol/client';

import { execFileSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { Socket } from 'node:net';
import { createInterface } from 'node:readline';

import { callTool } from '../../../src/mcp/oneshot.js';

const NOTHING_YET = 'nothing yet';
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

/**
 * Holds one seat until `signal` aborts: loops wait, writes each new message line, and posts each fifo line.
 * Returns the error text when a call is refused.
 */
export async function follow({
  client,
  postFifo,
  room,
  signal,
  write,
}: {
  client: Client;
  postFifo?: string;
  room: string;
  signal: AbortSignal;
  write: (line: string) => void;
}) {
  let posts = Promise.resolve();
  const stopFifo = postFifo
    ? readFifo({
        onLine: text => {
          posts = posts
            .then(async () => {
              const posted = await callTool(client, 'post', { room, text });
              if (posted.isError) write(`post refused: ${posted.text}\n`);
            })
            .catch((error: unknown) => write(`post failed: ${String(error)}\n`));
        },
        path: postFifo,
      })
    : undefined;
  const drain = async (): Promise<string | undefined> => {
    const read = await callTool(client, 'read_since', { room });
    if (read.isError) return read.text;
    messageLines(read.text).forEach(line => write(`${line}\n`));
    return read.text.includes(MORE) ? drain() : undefined;
  };
  const round = async (): Promise<string | undefined> => {
    if (signal.aborted) return undefined;
    const waited = await callTool(client, 'wait', { room }, { signal }).catch(() => {});
    if (!waited || signal.aborted) return undefined;
    if (waited.isError) return waited.text;
    const refused = waited.text.startsWith(NOTHING_YET) ? undefined : await drain();
    return refused ?? round();
  };
  try {
    return await round();
  } finally {
    stopFifo?.();
    await posts;
  }
}
