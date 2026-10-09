import type { Running, RunningInviteResult } from '../../contracts/feed.ts';
import type { KeyKind } from '../../src/daemon/keys.js';
import type { Tmux } from '../../src/flock/tmux.js';
import type { Server } from 'node:http';

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

import { vi } from 'vitest';

import { KEY_FILES, KEY_HEADER, loadKeys } from '../../src/daemon/keys.js';
import { createRouter } from '../../src/daemon/router.js';
import { feedRoutes } from '../../src/feed/routes.js';
import { createSpawner } from '../../src/flock/spawner.js';
import { parseStoredJson } from '../../src/lib/json.js';
import { scratchStore } from '../rooms/scratch.js';

/** A timer the test moves by hand. Ticks fire when the elapsed time crosses their interval. */
export function fakeEvery() {
  const timers = new Map<symbol, { ms: number; tick: () => void }>();
  const due = new Map<symbol, number>();
  let at = 0;
  const fire = (id: symbol) => {
    const timer = timers.get(id);
    const next = due.get(id);
    if (!timer || next === undefined || next > at) return;
    due.set(id, next + timer.ms);
    timer.tick();
    fire(id);
  };
  return {
    advance(ms: number) {
      at += ms;
      [...timers.keys()].forEach(fire);
    },
    every(ms: number, tick: () => void) {
      const id = Symbol('timer');
      timers.set(id, { ms, tick });
      due.set(id, at + ms);
      return () => {
        timers.delete(id);
      };
    },
    get running() {
      return timers.size;
    },
  };
}

export const FEED_RUNNING: Running = {
  agents: [
    {
      branch: 'rm-7/api',
      cwd: '/code/api',
      id: 's-1',
      kind: 'claude',
      reach: 'claude_session',
      repo: 'api',
      room: null,
      status: 'idle',
    },
  ],
  suggestions: [],
};

export const FEED_INVITED: RunningInviteResult = {
  invites: [{ id: 's-1', line: 'The human invites you to #rm-7 in messhall.', name: 'api', outcome: 'copy' }],
};

export const FEED_BUILD = { commit: 'a'.repeat(40), committed_at: '2026-01-01T00:00:00.000Z' };

/** The feed routes on a real port over a scratch store, with a hand moved timer and a fake tmux for the spawner. */
export async function feedServer() {
  const scratch = scratchStore();
  const keys = loadKeys({ dataDir: scratch.dataDir });
  const timer = fakeEvery();
  const tmux = vi.fn<Tmux>(() => Promise.resolve({ code: 0, stderr: '', stdout: '' }));
  const spawner = createSpawner({
    dataDir: scratch.dataDir,
    pollMs: 1,
    readyWithinMs: 50,
    settleMs: 0,
    shell: '/bin/zsh',
    store: scratch.store,
    tmux,
    url: 'http://127.0.0.1:7791',
  });
  // Plays the spawned claude: its first call carries the seat key from the mcp config the spawner wrote.
  const seatOnStart = ({ name = 'api', room = 'demo' } = {}) =>
    tmux.mockImplementation(args => {
      if (args[0] === 'new-session') {
        const file = path.join(scratch.dataDir, 'spawn', `${room}_${name}-mcp.json`);
        const config = parseStoredJson(readFileSync(file, 'utf8')) as {
          mcpServers: { messhall: { headers: Record<string, string> } };
        };
        const seatKey = config.mcpServers.messhall.headers['x-messhall-seat'];
        scratch.store.joinRoom({ as: name, kind: 'claude', room, seatKey });
      }
      const stdout = args[0] === 'display-message' ? '✳ Claude Code\n' : '';
      return Promise.resolve({ code: 0, stderr: '', stdout });
    });
  const running = {
    invite: vi.fn(() => Promise.resolve(FEED_INVITED)),
    list: vi.fn(() => Promise.resolve(FEED_RUNNING)),
  };
  const server: Server = createServer(
    createRouter(
      feedRoutes({
        build: FEED_BUILD,
        every: timer.every,
        keys,
        now: scratch.clock.now,
        relay: () => Promise.resolve(true),
        running,
        spawner,
        store: scratch.store,
      }),
    ),
  );
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const keyOf = (kind: KeyKind) => readFileSync(path.join(scratch.dataDir, KEY_FILES[kind]), 'utf8');
  return {
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => {
        server.close(resolve);
      });
      scratch.cleanup();
    },
    headers: (kind: KeyKind) => ({ [KEY_HEADER]: keyOf(kind) }),
    running,
    scratch,
    seatOnStart,
    timer,
    tmux,
    url: `http://127.0.0.1:${port}`,
  };
}

export interface Frame {
  comment?: string;
  data?: unknown;
  event?: string;
  id?: string;
}

/** Reads SSE frames off a fetch body, one at a time. */
export function frameReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const json = (text: string) => {
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      return text;
    }
  };
  const parse = (block: string) => {
    const frame: Frame = {};
    block.split('\n').forEach(line => {
      if (line.startsWith(':')) frame.comment = line.slice(1).trim();
      const [, field, value] = /^(id|event|data): (.*)$/.exec(line) ?? [];
      if (field === 'data') frame.data = json(value!);
      else if (field === 'id' || field === 'event') frame[field] = value;
    });
    return frame;
  };
  return {
    async next(): Promise<Frame> {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return parse(block);
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
      return this.next();
    },
    cancel: () => reader.cancel(),
  };
}
