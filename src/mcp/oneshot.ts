import type { Client } from '@modelcontextprotocol/client';

import { connectHttp } from './testing.js';

export interface ToolReply {
  isError: boolean;
  name: string;
  seconds: number;
  text: string;
}

const POSTED = /^posted #(\d+) /;

/** Calls one tool and keeps its text. A long call like `wait` stays open while it sends progress. */
export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolReply> {
  const started = performance.now();
  const result = await client.callTool({ arguments: args, name }, { resetTimeoutOnProgress: true, timeout: 300_000 });
  return {
    isError: Boolean(result.isError),
    name,
    seconds: (performance.now() - started) / 1000,
    text: result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n'),
  };
}

/** Joins, posts `text` if given, then leaves, even after a refused post. Leave keeps the cursor,
 * and the room reads "left", not "gone", when the session ends. */
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

/** Opens an MCP session on the daemon with the agent key, runs `use`, then ends it with DELETE. */
export async function withAgentSession<T>(
  { key, name, url }: { key: string; name: string; url: string },
  use: (client: Client) => Promise<T>,
) {
  let connected: Awaited<ReturnType<typeof connectHttp>>;
  try {
    connected = await connectHttp({ key, name, url });
  } catch (error) {
    return { error, ok: false } as const;
  }
  try {
    return { ok: true, value: await use(connected.client) } as const;
  } finally {
    await connected.transport.terminateSession().catch(() => {});
    await connected.client.close();
  }
}
