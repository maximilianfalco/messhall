import type { FlockSeat } from '../../contracts/feed.ts';
import type { Launch } from '../../contracts/room.ts';
import type { RoomStore } from '../rooms/store.js';
import type { Tmux } from './tmux.js';

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { HUMAN_NAME } from '../../contracts/room.ts';
import { SPAWN_READY_MS } from '../config.js';
import { KEY_FILES, KEY_HEADER } from '../daemon/keys.js';
import { logger } from '../lib/logger.js';
import { shellLine } from '../lib/shell.js';
import { SEAT_HEADER, SERVER_NAME } from '../mcp/constants.js';

import { dialogKeys, typePrompt, until, tmux as runTmux } from './tmux.js';

export const SESSION_PREFIX = 'messhall_';
export const SPAWN_DIR = 'spawn';
const SETTLE_MS = 1000;
const PANE_FORMAT = '#{session_name}\t#{pane_pid}';

interface Seat {
  name: string;
  room: string;
}

type Ready = 'dropped' | 'login' | 'seated' | 'timeout' | 'untrusted';

/** The tmux session a spawned seat runs in. Names never hold `_`, so room and name can never run together. */
export const sessionName = ({ name, room }: Seat) => `${SESSION_PREFIX}${room}_${name}`;

// A bare `-t name` falls back to a prefix match, which would hit another seat's session.
const exactTarget = (seat: Seat) => `=${sessionName(seat)}:`;

/** The first prompt typed into a spawned claude. Its seat is already taken, so it only reads its role. */
export const seatedPrompt = ({ name, role, room }: Seat & { role: string }) =>
  [
    `You are seated in #${room} as ${name} with the role ${role}. Your seat is yours already, so do not call join.`,
    `Call my_role for #${room} now and follow the instructions it returns.`,
    `Talk in the room only through the messhall tools and keep your seat until your role says to leave.`,
    `Answer a ring, a human line or a mention of you right away, then go back to work.`,
    `Whenever a role line mentions you, call my_role again and switch to what it says.`,
  ].join(' ');

const codexPrompt = ({ invite, name, room }: Seat & { invite: string }) =>
  [
    `Run echo $CODEX_THREAD_ID.`,
    `Then join #${room} as ${name} with the messhall tools, with thread_id set to that value and invite set to ${invite}.`,
    `Then call my_role for #${room} and follow the instructions it returns. Keep your seat until your role says to leave.`,
  ].join(' ');

/** The agent argv, built only from fixed parts, the checked model and daemon-made names and paths.
 * Codex has no per-process header, so its invite rides in its first prompt; claude reads its seat from `mcpConfig`. */
export function agentArgv({
  agent,
  invite,
  mcpConfig,
  model,
  name,
  room,
}: Seat & { agent: Launch['agent']; invite: string; mcpConfig: string; model?: string }) {
  const modelArgs = model ? ['--model', model] : [];
  if (agent === 'codex') return ['codex', ...modelArgs, codexPrompt({ invite, name, room })];
  return [
    'claude',
    '--mcp-config',
    mcpConfig,
    '--dangerously-load-development-channels',
    `server:${SERVER_NAME}`,
    '--allowedTools',
    `mcp__${SERVER_NAME}`,
    ...modelArgs,
  ];
}

/** The `tmux new-session` args. A login shell runs the agent, so it gets the user's PATH, not launchd's bare one. */
export function tmuxStartArgs({
  argv,
  cwd,
  session,
  shell,
}: {
  argv: string[];
  cwd: string;
  session: string;
  shell: string;
}) {
  const size = ['-x', '200', '-y', '50'];
  return ['new-session', '-d', '-s', session, ...size, '-c', cwd, shellLine([shell, '-lic', shellLine(argv)])];
}

/** The `--mcp-config` json for a spawned claude: this daemon's url, the agent key and the seat key.
 * It beats the user's own messhall entry, so the seat works on any port and with an older install. */
export const mcpConfigJson = ({ key, seatKey, url }: { key: string; seatKey: string; url: string }) =>
  JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: { headers: { [KEY_HEADER]: key, [SEAT_HEADER]: seatKey }, type: 'http', url: `${url}/mcp` },
    },
  });

const isFolder = (dir: string) =>
  path.isAbsolute(dir) && Boolean(statSync(dir, { throwIfNoEntry: false })?.isDirectory());

/** Starts agents for invites in detached tmux sessions, answers their known dialogs and lists or stops them.
 * A seat that leaves or is removed gets its session stopped. */
export function createSpawner({
  dataDir,
  pollMs,
  readyWithinMs = SPAWN_READY_MS,
  settleMs = SETTLE_MS,
  shell = userInfo().shell ?? '/bin/zsh',
  store,
  tmux = runTmux,
  url,
}: {
  dataDir: string;
  pollMs?: number;
  readyWithinMs?: number;
  settleMs?: number;
  shell?: string;
  store: RoomStore;
  tmux?: Tmux;
  url: string;
}) {
  const spawnDir = path.join(dataDir, SPAWN_DIR);
  const configFile = ({ name, room }: Seat) => path.join(spawnDir, `${room}_${name}-mcp.json`);

  // 0600, since it holds the agent key.
  const writeConfig = (seat: Seat, seatKey: string) => {
    const key = readFileSync(path.join(dataDir, KEY_FILES.agent), 'utf8').trim();
    mkdirSync(spawnDir, { recursive: true });
    writeFileSync(configFile(seat), mcpConfigJson({ key, seatKey, url }), { mode: 0o600 });
  };

  const presenceOf = ({ name, room }: Seat) => store.listMembers(room).find(member => member.name === name)?.presence;

  // Answers dialogs until the agent's first call takes the seat, or a login screen or the deadline stops it.
  // Only a seat the human asked for may trust its folder, since an agent picks the cwd of its own spawns.
  const waitSeated = async (seat: Seat, { trust }: { trust: boolean }) => {
    const target = exactTarget(seat);
    const ready = await until<Ready>(
      Date.now() + readyWithinMs,
      async () => {
        const presence = presenceOf(seat);
        if (!presence) return 'dropped';
        if (presence !== 'invited') return 'seated';
        const dialog = dialogKeys((await tmux(['capture-pane', '-p', '-t', target])).stdout);
        if (dialog.kind === 'login') return 'login';
        if (dialog.kind === 'none') return;
        if (dialog.kind === 'trust' && !trust) return 'untrusted';
        await tmux(['send-keys', '-t', target, ...dialog.keys]);
        await sleep(settleMs);
      },
      pollMs,
    );
    return ready ?? 'timeout';
  };

  const stop = async (seat: Seat) => {
    const killed = await tmux(['kill-session', '-t', exactTarget(seat)]);
    rmSync(configFile(seat), { force: true });
    return killed.code === 0;
  };

  // A seat that left or was dropped must not keep its agent running. Only spawned seats have a session by this name.
  store.events.on(({ event }) => {
    if (event.type !== 'member' || (event.change !== 'left' && event.change !== 'removed')) return;
    stop({ name: event.member.name, room: event.room }).catch((error: unknown) =>
      logger.error(error instanceof Error ? error : new Error(String(error)), { message: 'stopping a seat failed' }),
    );
  });

  const giveUp = async (seat: Seat) => {
    await stop(seat);
    store.removeMember({ member: seat.name, room: seat.room });
  };

  return {
    /** Makes the invite, then starts its agent and waits for the agent's first call to take the seat.
     * Any failure after the invite kills the session and drops the seat, so the name is free again. */
    async spawn({
      by,
      instructions,
      launch,
      name,
      role,
      room,
    }: Seat & { by: string; instructions?: string; launch: Launch; role: string }) {
      if (!isFolder(launch.cwd)) return { ok: false, reason: 'no_cwd' } as const;
      const invited = store.invite({ by, instructions, launch, name, role, room });
      if (!invited.ok) return invited;
      const seat = { name, room };
      const session = sessionName(seat);
      const { agent, cwd, model } = launch;
      const argv = agentArgv({ ...seat, agent, invite: invited.seatKey, mcpConfig: configFile(seat), model });
      await stop(seat);
      if (agent === 'claude') writeConfig(seat, invited.seatKey);
      const started = await tmux(tmuxStartArgs({ argv, cwd, session, shell }));
      if (started.code !== 0) {
        await giveUp(seat);
        return { detail: started.stderr.trim(), ok: false, reason: 'tmux' } as const;
      }
      const ready = await waitSeated(seat, { trust: by === HUMAN_NAME });
      if (ready !== 'seated') {
        await giveUp(seat);
        return { ok: false, reason: ready } as const;
      }
      if (agent === 'claude') {
        const typed = await typePrompt(exactTarget(seat), seatedPrompt({ ...seat, role }), {
          run: tmux,
          settleMs,
          titleWaitMs: readyWithinMs,
        });
        if (typed !== 'sent') {
          await giveUp(seat);
          return { ok: false, reason: typed } as const;
        }
      }
      const member = store.listMembers(room).find(found => found.name === name);
      if (!member) return { ok: false, reason: 'dropped' } as const;
      return { member, ok: true, session } as const;
    },

    /** Kills the seat's tmux session, if it has one, and removes its mcp config. */
    stop,

    /** Every seat started from an invite, in `room` or in every room, with its session and whether it runs. */
    async list({ room }: { room?: string }) {
      const listing = (await tmux(['list-panes', '-a', '-F', PANE_FORMAT])).stdout;
      const pids = new Map(
        listing.split('\n').map(line => {
          const [session = '', pid = ''] = line.split('\t');
          return [session, Number(pid)] as const;
        }),
      );
      const rooms = room ? [room] : store.listRooms().map(found => found.name);
      return rooms.flatMap(roomName =>
        store.listMembers(roomName).flatMap((member): FlockSeat[] => {
          const launch = store.launchOf({ name: member.name, room: roomName });
          if (!launch) return [];
          const session = sessionName({ name: member.name, room: roomName });
          const pid = pids.get(session) ?? null;
          return [
            {
              agent: launch.agent,
              cwd: launch.cwd,
              name: member.name,
              pid,
              presence: member.presence,
              process: pid === null ? 'gone' : 'running',
              role: member.role,
              room: roomName,
              session,
            },
          ];
        }),
      );
    },
  };
}

export type Spawner = ReturnType<typeof createSpawner>;
