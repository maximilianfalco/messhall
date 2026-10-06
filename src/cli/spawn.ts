import type { Command } from 'commander';

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import pc from 'picocolors';

import { feedErrorSchema, flockSchema, spawnResultSchema } from '../../contracts/feed.ts';
import { LAUNCH_AGENTS } from '../../contracts/room.ts';
import { daemonUrl, dataDir } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';

import { readHumanKey } from './say.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface Daemon {
  dataDir: string;
  fetch: Fetch;
  url: string;
}

const fail = (text: string) => ({ code: 1, output: pc.red(text) }) as const;

// One place for the key read, the down daemon and the refusal line, so every flock command fails the same way.
async function asHuman(
  { dataDir: dir, fetch, url }: Daemon,
  route: string,
  init: { body?: unknown; method: 'DELETE' | 'GET' | 'POST' },
) {
  const key = readHumanKey(dir);
  if (!key) return { error: `no human key in ${dir}, start the daemon once`, ok: false } as const;
  let response: Response;
  try {
    response = await fetch(`${url}${route}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
      method: init.method,
    });
  } catch {
    return { error: `messhall is down, nothing answers on ${url}. run messhall start`, ok: false } as const;
  }
  const body: unknown = await response.json().catch(() => {});
  if (response.ok) return { body, ok: true } as const;
  const refused = feedErrorSchema.safeParse(body);
  return {
    error: `messhall refused: ${refused.success ? refused.data.error : `http ${response.status}`}`,
    ok: false,
  } as const;
}

/** Starts an agent in a detached tmux session, seated in `room` as `name` with `role` from its first call. */
export async function runSpawn({
  agent,
  cwd,
  instructions,
  model,
  name,
  role,
  room,
  ...daemon
}: Daemon & {
  agent?: string;
  cwd: string;
  instructions?: string;
  model?: string;
  name: string;
  role: string;
  room: string;
}) {
  const isFile = instructions && statSync(instructions, { throwIfNoEntry: false })?.isFile();
  const text = isFile ? readFileSync(instructions, 'utf8') : instructions;
  const body = { agent, cwd: path.resolve(cwd), instructions: text, model, name, role };
  const sent = await asHuman(daemon, `/api/rooms/${encodeURIComponent(room)}/spawn`, { body, method: 'POST' });
  if (!sent.ok) return fail(sent.error);
  const spawned = spawnResultSchema.safeParse(sent.body);
  if (!spawned.success) return fail('messhall answered with something that is not a spawn result');
  const { session } = spawned.data;
  return {
    code: 0,
    output: [`${name} is seated in #${room} as ${role}`, pc.dim(`watch it: tmux attach -t ${session}`)].join('\n'),
  } as const;
}

async function readFlock(daemon: Daemon, room?: string) {
  const query = room ? `?room=${encodeURIComponent(room)}` : '';
  const sent = await asHuman(daemon, `/api/flock${query}`, { method: 'GET' });
  if (!sent.ok) return sent;
  const parsed = flockSchema.safeParse(sent.body);
  return parsed.success
    ? ({ ok: true, seats: parsed.data.seats } as const)
    : ({ error: 'messhall answered with something that is not a flock', ok: false } as const);
}

/** Every spawned seat, one padded line each: room, name, role, presence, agent, process and tmux session. */
export async function runFlock({ room, ...daemon }: Daemon & { room?: string }) {
  const flock = await readFlock(daemon, room);
  if (!flock.ok) return fail(flock.error);
  if (!flock.seats.length) return { code: 0, output: pc.dim('no spawned seats') } as const;
  const rows = flock.seats.map(seat => [
    `#${seat.room}`,
    seat.name,
    seat.role,
    seat.presence,
    seat.agent,
    seat.process,
    seat.session,
  ]);
  const widths = rows[0]!.map((_cell, column) => Math.max(...rows.map(row => row[column]!.length)));
  const lines = rows.map(row =>
    row
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join('  ')
      .trimEnd(),
  );
  return { code: 0, output: lines.join('\n') } as const;
}

/** Stops a spawned seat by name: the daemon kills its tmux session and removes the seat. */
export async function runFlockStop({ name, room, ...daemon }: Daemon & { name: string; room?: string }) {
  const flock = await readFlock(daemon, room);
  if (!flock.ok) return fail(flock.error);
  const matches = flock.seats.filter(seat => seat.name === name);
  if (!matches.length) return fail(`no spawned seat ${name}${room ? ` in #${room}` : ''}`);
  if (matches.length > 1) {
    return fail(`${name} is spawned in ${matches.map(seat => `#${seat.room}`).join(' and ')}, pass --room`);
  }
  const seatRoom = matches[0]!.room;
  const route = `/api/rooms/${encodeURIComponent(seatRoom)}/members/${encodeURIComponent(name)}`;
  const sent = await asHuman(daemon, route, { method: 'DELETE' });
  if (!sent.ok) return fail(sent.error);
  return { code: 0, output: `stopped ${name} in #${seatRoom}, its seat is removed` } as const;
}

const daemonDeps = (): Daemon => ({ dataDir: dataDir(), fetch, url: daemonUrl() });

const print = (result: { code: number; output: string }) => {
  if (result.code === 0) console.log(result.output);
  else console.error(result.output);
  process.exitCode = result.code;
};

/** Registers `spawn <room> <name>`, `flock [room]` and `flock stop <name>`. */
export function registerSpawn(program: Command) {
  program
    .command('spawn')
    .description('Start an agent in a detached tmux session as the human, seated with its role from its first call.')
    .argument('<room>', 'room name')
    .argument('<name>', 'name of the new seat')
    .requiredOption('--role <role>', 'worker, reviewer, observer or any short slug')
    .option('--instructions <file or text>', 'what the agent should do in this role')
    .option('--cwd <dir>', 'folder the agent starts in, this one by default', '.')
    .option('--agent <agent>', LAUNCH_AGENTS.join(' or '), 'claude')
    .option('--model <model>', 'model the agent runs on, its default when left out')
    .action(
      async (
        room: string,
        name: string,
        options: { agent: string; cwd: string; instructions?: string; model?: string; role: string },
      ) => {
        print(await runSpawn({ ...daemonDeps(), ...options, name, room }));
      },
    );

  const flock = program
    .command('flock')
    .description('List spawned seats: role, presence, agent, whether the process runs, and the tmux session.')
    .argument('[room]', 'only this room')
    .action(async (room?: string) => {
      print(await runFlock({ ...daemonDeps(), room }));
    });
  flock
    .command('stop')
    .description('Kill a spawned seat tmux session and remove the seat.')
    .argument('<name>', 'seat name')
    .option('--room <room>', 'the room, when the name is spawned in more than one')
    .action(async (name: string, options: { room?: string }) => {
      print(await runFlockStop({ ...daemonDeps(), name, room: options.room }));
    });
}
