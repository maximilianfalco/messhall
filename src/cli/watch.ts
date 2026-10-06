import type { Snapshot } from '../../contracts/feed.ts';
import type { Frame } from '../lib/sse.js';
import type { Command } from 'commander';

import { clearLine, createInterface, cursorTo } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

import pc from 'picocolors';

import { busEventSchema } from '../../contracts/events.ts';
import { feedErrorSchema, SNAPSHOT_EVENT, snapshotSchema } from '../../contracts/feed.ts';
import { daemonUrl, dataDir, WATCH_RECONNECT_MS } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';
import { renderEvent, renderRooms, renderSnapshot } from '../feed/render.js';
import { parseStoredJson } from '../lib/json.js';
import { readFrames } from '../lib/sse.js';

import { readHumanKey, runSay } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Print = (line: string) => void;

const HELP = 'type to post as human. /rooms, /room <name>, /reopen, /quit';

/** One watch session: the room it shows, the last event it saw, and what each typed line does. */
export function createWatch({
  dataDir: dir,
  fetch,
  print,
  room,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  print: Print;
  room?: string;
  url: string;
}) {
  const key = readHumanKey(dir);
  const down = `messhall is down, nothing answers on ${url}. run messhall start`;
  let current = room;
  let seq = 0;

  async function refusal(response: Response, what: string) {
    const body: unknown = await response.json().catch(() => {});
    const refused = feedErrorSchema.safeParse(body);
    return `messhall refused the ${what}: ${refused.success ? refused.data.error : `http ${response.status}`}`;
  }

  async function snapshot(): Promise<Snapshot | string> {
    if (!key) return `no human key in ${dir}, start the daemon once`;
    let response: Response;
    try {
      response = await fetch(`${url}/api/snapshot`, { headers: { [KEY_HEADER]: key } });
    } catch {
      return down;
    }
    if (!response.ok) return refusal(response, 'snapshot');
    return snapshotSchema.parse(await response.json());
  }

  /** Prints the snapshot for the current room. False when it could not load. */
  async function load(show: (snap: Snapshot) => string[] = snap => renderSnapshot({ room: current, snapshot: snap })) {
    const result = await snapshot();
    if (typeof result === 'string') {
      print(pc.red(result));
      return false;
    }
    seq = Math.max(seq, result.seq);
    show(result).forEach(print);
    return true;
  }

  async function reopen(name: string) {
    try {
      const response = await fetch(`${url}/api/rooms/${encodeURIComponent(name)}/reopen`, {
        headers: { [KEY_HEADER]: key },
        method: 'POST',
      });
      if (!response.ok) print(pc.red(await refusal(response, 'reopen')));
    } catch {
      print(pc.red(down));
    }
  }

  function onFrame(frame: Frame) {
    seq = Number(frame.id);
    const data = parseStoredJson(frame.data);
    const lines =
      frame.event === SNAPSHOT_EVENT
        ? renderSnapshot({ room: current, snapshot: snapshotSchema.parse(data) })
        : renderEvent({ event: busEventSchema.parse(data), room: current });
    lines.forEach(print);
  }

  /** Reads one connection to the end. True when the daemon answered. */
  async function stream({ live, signal }: { live: boolean; signal: AbortSignal }) {
    try {
      const response = await fetch(`${url}/api/events`, {
        headers: { [KEY_HEADER]: key, 'last-event-id': String(seq) },
        signal,
      });
      if (!response.ok || !response.body) return false;
      if (!live) print(pc.dim('feed is back'));
      for await (const frame of readFrames(response.body)) onFrame(frame);
      return true;
    } catch {
      return false;
    }
  }

  /** Tails the feed until `signal` aborts, reconnecting after `seq` each time it drops. */
  async function follow({
    live = true,
    signal,
    wait,
  }: {
    live?: boolean;
    signal: AbortSignal;
    wait: (ms: number) => Promise<unknown>;
  }): Promise<void> {
    if (signal.aborted) return;
    const answered = await stream({ live, signal });
    if (signal.aborted) return;
    if (answered || live) print(pc.dim('feed dropped, reconnecting'));
    await wait(WATCH_RECONNECT_MS);
    return follow({ live: false, signal, wait });
  }

  /** Runs one typed line: a slash command, or a post as the human. */
  async function handle(line: string) {
    const text = line.trim();
    if (!text) return;
    const [command, arg] = text.split(/\s+/);
    if (command === '/quit') return 'quit' as const;
    if (command === '/rooms') {
      await load(snap => renderRooms({ snapshot: snap }));
      return;
    }
    if (command === '/room') {
      current = arg;
      await load();
      return;
    }
    if (text.startsWith('/') && command !== '/reopen') {
      print(pc.dim(HELP));
      return;
    }
    if (!current) {
      print(pc.yellow('pick a room first: /room <name>'));
      return;
    }
    if (command === '/reopen') {
      await reopen(current);
      return;
    }
    const posted = await runSay({ dataDir: dir, fetch, room: current, text, url });
    if (posted.code !== 0) print(posted.output);
  }

  return {
    follow,
    handle,
    load,
    onFrame,
    get room() {
      return current;
    },
  };
}

/** Shows the snapshot, then, on a tty, tails the feed under a prompt that posts as the human. Returns the exit code. */
export async function runWatch({
  dataDir: dir,
  fetch,
  print,
  room,
  tty,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  print: Print;
  room?: string;
  tty: boolean;
  url: string;
}) {
  if (!tty) return (await createWatch({ dataDir: dir, fetch, print, room, url }).load()) ? 0 : 1;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Feed lines land above the prompt, so the half typed line is redrawn under them.
  const above: Print = line => {
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);
    process.stdout.write(`${line}\n`);
    rl.prompt(true);
  };
  const watch = createWatch({ dataDir: dir, fetch, print: above, room, url });
  const setPrompt = () => rl.setPrompt(pc.magenta(`${watch.room ? `#${watch.room}` : 'all rooms'} › `));
  setPrompt();
  if (!(await watch.load())) {
    rl.close();
    return 1;
  }
  above(pc.dim(HELP));

  const controller = new AbortController();
  const following = watch.follow({
    signal: controller.signal,
    wait: ms => sleep(ms, undefined, { signal: controller.signal }).catch(() => {}),
  });
  rl.on('SIGINT', () => rl.close());
  rl.on('line', async line => {
    const outcome = await watch.handle(line);
    if (outcome === 'quit') {
      rl.close();
      return;
    }
    setPrompt();
    rl.prompt();
  });
  await new Promise(resolve => {
    rl.once('close', resolve);
  });
  controller.abort();
  await following;
  process.stdout.write('\n');
  return 0;
}

/** Registers `watch [room]`. */
export function registerWatch(program: Command) {
  program
    .command('watch')
    .description('Watch the rooms live and post as the human. Without a tty, print the rooms and exit.')
    .argument('[room]', 'only this room')
    .action(async (room?: string) => {
      process.exitCode = await runWatch({
        dataDir: dataDir(),
        fetch,
        print: line => console.log(line),
        room,
        tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        url: daemonUrl(),
      });
    });
}
