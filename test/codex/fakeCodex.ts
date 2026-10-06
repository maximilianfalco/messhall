import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WebSocketServer } from 'ws';

export interface Frame {
  id?: number;
  method: string;
  params: unknown;
}

function parseFrame(text: string) {
  try {
    return JSON.parse(text) as Frame;
  } catch {
    return { method: 'unparsed', params: text };
  }
}

type Answer = { error: string } | { hold: true } | { result: unknown };

/** A Codex control socket on a temp unix path: records every frame and answers by method. */
export async function fakeCodex(answers: Record<string, (params: unknown) => Answer> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'messhall-codex-'));
  const socketPath = path.join(dir, 'control.sock');
  const frames: Frame[] = [];
  const held: { frame: Frame; reply: (result: unknown) => void }[] = [];
  let connections = 0;
  let http: Server;
  let wss: WebSocketServer;

  const serve = async () => {
    http = createServer();
    wss = new WebSocketServer({ server: http });
    wss.on('connection', ws => {
      connections += 1;
      ws.on('message', data => {
        const frame = parseFrame(String(data));
        frames.push(frame);
        if (frame.id === undefined) return;
        const send = (body: object) => ws.send(JSON.stringify({ id: frame.id, ...body }));
        if (frame.method === 'initialize') {
          send({ result: { codexHome: dir, platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake' } });
          return;
        }
        const answer = answers[frame.method]?.(frame.params) ?? { error: `unknown method ${frame.method}` };
        if ('hold' in answer) held.push({ frame, reply: result => send({ result }) });
        else if ('error' in answer) send({ error: { code: -32_600, message: answer.error } });
        else send({ result: answer.result });
      });
    });
    await new Promise<void>(resolve => {
      http.listen(socketPath, resolve);
    });
  };
  await serve();

  return {
    get connections() {
      return connections;
    },
    /** Drops every open connection, as a daemon restart would. */
    dropAll() {
      wss.clients.forEach(ws => ws.terminate());
    },
    frames,
    held,
    serve,
    socketPath,
    /** Stops listening and drops every connection. */
    async stop() {
      wss.clients.forEach(ws => ws.terminate());
      await new Promise<void>(resolve => {
        wss.close(() => http.close(() => resolve()));
      });
    },
    async cleanup() {
      await this.stop();
      rmSync(dir, { force: true, recursive: true });
    },
  };
}

/** Timers that only fire when told, so backoff runs without sleeping. */
export function fakeTimers() {
  let timers: { fire: () => void; ms: number }[] = [];
  return {
    delays: () => timers.map(timer => timer.ms),
    fireAll() {
      const due = timers;
      timers = [];
      due.forEach(timer => timer.fire());
    },
    setTimer(fire: () => void, ms: number) {
      const timer = { fire, ms };
      timers.push(timer);
      return () => {
        timers = timers.filter(item => item !== timer);
      };
    },
  };
}

export type FakeCodex = Awaited<ReturnType<typeof fakeCodex>>;
