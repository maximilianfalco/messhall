import type { Command } from 'commander';

import pc from 'picocolors';

import { feedErrorSchema, snapshotSchema } from '../../contracts/feed.ts';
import { ORCHESTRATOR_ROLE } from '../../contracts/room.ts';
import { daemonUrl, dataDir } from '../config.js';
import { KEY_HEADER } from '../daemon/keys.js';
import { renderRooms } from '../feed/render.js';

import { readHumanKey } from './say.js';
import { ORCHESTRATOR_BRIEF, readBrief, seatedLines, spawnOrchestrator } from './spawn.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

type RoomAction =
  | { action: 'close' | 'reopen'; name: string }
  | { action: 'kick'; member: string; name: string }
  | { action: 'list' }
  | { action: 'mute' | 'unmute'; member: string; name: string }
  | { action: 'new'; name: string; orchestrator?: { brief?: string; cwd: string }; topic?: string }
  | { action: 'nudges'; name: string; on: boolean };

function done(input: Exclude<RoomAction, { action: 'list' }>) {
  if (input.action === 'kick') return `removed ${input.member} from #${input.name}`;
  if (input.action === 'mute') return `muted ${input.member} in #${input.name}, it can read but not post`;
  if (input.action === 'unmute') return `unmuted ${input.member} in #${input.name}`;
  if (input.action === 'new') return `made #${input.name}, standing until you close it`;
  if (input.action === 'nudges') {
    return input.on
      ? `review nudges on in #${input.name}, a request quiet 15 min goes to another reviewer`
      : `review nudges off in #${input.name}`;
  }
  return `${input.action === 'close' ? 'closed' : 'reopened'} #${input.name}`;
}

const fail = (text: string) => ({ code: 1, output: [pc.red(text)] }) as const;

function request(input: RoomAction, url: string) {
  if (input.action === 'list') return { init: {}, url: `${url}/api/snapshot` };
  if (input.action === 'new') {
    const { name, topic } = input;
    return { init: { body: JSON.stringify({ name, topic }), method: 'POST' }, url: `${url}/api/rooms` };
  }
  if (input.action === 'kick') {
    const path = `${encodeURIComponent(input.name)}/members/${encodeURIComponent(input.member)}`;
    return { init: { method: 'DELETE' }, url: `${url}/api/rooms/${path}` };
  }
  if (input.action === 'mute' || input.action === 'unmute') {
    const path = `${encodeURIComponent(input.name)}/members/${encodeURIComponent(input.member)}/${input.action}`;
    return { init: { method: 'POST' }, url: `${url}/api/rooms/${path}` };
  }
  const action = input.action === 'nudges' ? `nudges-${input.on ? 'on' : 'off'}` : input.action;
  return { init: { method: 'POST' }, url: `${url}/api/rooms/${encodeURIComponent(input.name)}/${action}` };
}

/** Makes, closes, reopens or lists rooms, turns review nudges on or off, kicks any agent seat, or mutes a member, as the human through the daemon. Prints one line per room, or one red line.
 * A new room with `orchestrator` also spawns claude as its orchestrator, the brief checked before the room is made. */
export async function runRoom({
  dataDir: dir,
  fetch,
  input,
  url,
}: {
  dataDir: string;
  fetch: Fetch;
  input: RoomAction;
  url: string;
}) {
  const key = readHumanKey(dir);
  if (!key) return fail(`no human key in ${dir}, start the daemon once`);
  const lead = input.action === 'new' ? input.orchestrator : undefined;
  const brief = lead && readBrief(lead.brief ?? ORCHESTRATOR_BRIEF);
  if (brief && !brief.ok) return fail(brief.error);

  const call = request(input, url);
  let response: Response;
  try {
    response = await fetch(call.url, {
      ...call.init,
      headers: { 'content-type': 'application/json', [KEY_HEADER]: key },
    });
  } catch {
    return fail(`messhall is down, nothing answers on ${url}. run messhall start`);
  }
  const body: unknown = await response.json().catch(() => {});
  if (!response.ok) {
    const refused = feedErrorSchema.safeParse(body);
    return fail(`messhall refused: ${refused.success ? refused.data.error : `http ${response.status}`}`);
  }
  if (input.action === 'list') {
    return { code: 0, output: renderRooms({ snapshot: snapshotSchema.parse(body) }) } as const;
  }
  if (!lead || !brief?.ok) return { code: 0, output: [done(input)] } as const;
  const room = input.name;
  const spawned = await spawnOrchestrator({ brief: brief.text, cwd: lead.cwd, dataDir: dir, fetch, room, url });
  if (!spawned.ok) return { code: 1, output: [done(input), pc.red(spawned.error)] } as const;
  const seated = seatedLines({ name: ORCHESTRATOR_ROLE, role: ORCHESTRATOR_ROLE, room, session: spawned.session });
  return { code: 0, output: [done(input), ...seated] } as const;
}

async function print(input: RoomAction) {
  const result = await runRoom({ dataDir: dataDir(), fetch, input, url: daemonUrl() });
  if (result.code === 0) result.output.forEach(line => console.log(line));
  else result.output.forEach(line => console.error(line));
  process.exitCode = result.code;
}

/** Registers `room new | close | reopen | kick | mute | unmute | nudges | list`. */
export function registerRoom(program: Command) {
  const room = program
    .command('room')
    .description('Make, close, reopen and list rooms, and kick or mute members, as the human.');
  room
    .command('new')
    .description('Make a standing room. It stays open until you close it.')
    .argument('<name>', 'room name')
    .option('--topic <text>', 'what the room is for')
    .option('--orchestrator', 'also start claude as the room orchestrator, in tmux')
    .option('--cwd <dir>', 'with --orchestrator, the folder it starts in, this one by default')
    .option('--brief <file>', 'with --orchestrator, its role instructions, docs/briefs/orchestrator.md by default')
    .action((name: string, options: { brief?: string; cwd?: string; orchestrator?: boolean; topic?: string }) => {
      const { brief, cwd, orchestrator, topic } = options;
      if (!orchestrator && (brief || cwd)) return program.error('--cwd and --brief go with --orchestrator');
      const lead = orchestrator ? { brief, cwd: cwd ?? '.' } : undefined;
      return print({ action: 'new', name, orchestrator: lead, topic });
    });
  room
    .command('close')
    .description('Close a room. Agents cannot post until you reopen it.')
    .argument('<name>', 'room name')
    .action((name: string) => print({ action: 'close', name }));
  room
    .command('reopen')
    .description('Reopen a closed room.')
    .argument('<name>', 'room name')
    .action((name: string) => print({ action: 'reopen', name }));
  room
    .command('kick')
    .description('Remove an agent from a room now, here, away or left. Its posts keep its name.')
    .argument('<room>', 'room name')
    .argument('<member>', 'member name')
    .action((name: string, member: string) => print({ action: 'kick', member, name }));
  room
    .command('mute')
    .description('Mute a member: it can still read, but its posts are refused and nothing rings it.')
    .argument('<room>', 'room name')
    .argument('<member>', 'member name')
    .action((name: string, member: string) => print({ action: 'mute', member, name }));
  room
    .command('unmute')
    .description('Let a muted member post again.')
    .argument('<room>', 'room name')
    .argument('<member>', 'member name')
    .action((name: string, member: string) => print({ action: 'unmute', member, name }));
  room
    .command('nudges')
    .description('Turn review nudges on or off. On, a review request quiet 15 min goes to another reviewer.')
    .argument('<room>', 'room name')
    .argument('<state>', 'on or off')
    .action((name: string, state: string) => {
      if (state !== 'on' && state !== 'off') return program.error('state is on or off');
      return print({ action: 'nudges', name, on: state === 'on' });
    });
  room
    .command('list')
    .description('List every room, closed ones too.')
    .action(() => print({ action: 'list' }));
}
