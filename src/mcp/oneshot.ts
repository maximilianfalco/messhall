import type { Client } from '@modelcontextprotocol/client';

import { SdkHttpError } from '@modelcontextprotocol/client';

import { connectHttp } from './testing.js';

export interface ToolReply {
  isError: boolean;
  name: string;
  seconds: number;
  text: string;
}

const POSTED = /^posted #(\d+) /;

/** Calls one tool and keeps its text. A long call like `wait` stays open while it sends progress. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ToolReply> {
  const started = performance.now();
  const result = await client.callTool(
    { arguments: args, name },
    { resetTimeoutOnProgress: true, signal, timeout: 300_000 },
  );
  return {
    isError: Boolean(result.isError),
    name,
    seconds: (performance.now() - started) / 1000,
    text: result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n'),
  };
}

/** Joins, posts `text` if given, then leaves, even after a refused post. Leave keeps the cursor,
 * and the room reads "left", not "away", when the session ends. */
export async function joinPostLeave({
  as,
  client,
  done,
  room,
  text,
}: {
  as: string;
  client: Client;
  done?: boolean;
  room: string;
  text?: string;
}) {
  const joined = await callTool(client, 'join', { as, room });
  if (joined.isError) return { replies: [joined] };
  const posted = text ? await callTool(client, 'post', { done, room, text }) : undefined;
  const left = await callTool(client, 'leave', { room });
  const id = posted && !posted.isError ? POSTED.exec(posted.text)?.[1] : undefined;
  return { id: id ? Number(id) : undefined, replies: posted ? [joined, posted, left] : [joined, left] };
}

const STREAM_LOST = /^Maximum reconnection attempts/;
const DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET']);

/** True when the daemon dropped the session or is down or failing: a 404 or 5xx, a refused
 * connection, or a stream that could not come back. A fresh session may work then. */
export function lostSession(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof SdkHttpError) return error.status === 404 || error.status >= 500;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && DOWN_CODES.has(code)) return true;
  return STREAM_LOST.test(error.message) || lostSession(error.cause);
}

interface AgentTarget {
  key: string;
  name: string;
  seat?: string;
  url: string;
}

/** Opens an MCP session on the daemon with the agent key, and the seat key when given. `close` ends it with DELETE and never throws. */
export async function openAgentSession(target: AgentTarget) {
  const { client, transport } = await connectHttp(target);
  return {
    client,
    async close() {
      await transport.terminateSession().catch(() => {});
      await client.close().catch(() => {});
    },
  };
}

export type AgentSession = Awaited<ReturnType<typeof openAgentSession>>;

/** Opens an MCP session on the daemon with the agent key, runs `use`, then ends it with DELETE. */
export async function withAgentSession<T>(options: AgentTarget, use: (client: Client) => Promise<T>) {
  let session: AgentSession;
  try {
    session = await openAgentSession(options);
  } catch (error) {
    return { error, ok: false } as const;
  }
  try {
    return { ok: true, value: await use(session.client) } as const;
  } finally {
    await session.close();
  }
}
