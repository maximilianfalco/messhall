import type { FlockSeat } from '../../contracts/feed.ts';
import type { Launch, Presence } from '../../contracts/room.ts';
import type { RoomStore } from '../rooms/store.js';
import type { HealSeat, HealStep, Watch } from './heal.js';
import type { Tmux } from './tmux.js';

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { HUMAN_NAME } from '../../contracts/room.ts';
import { API_PROBE_MS, API_PROBE_URL, SPAWN_READY_MS, UNSTICK_TRIES } from '../config.js';
import { KEY_FILES, KEY_HEADER } from '../daemon/keys.js';
import { logger } from '../lib/logger.js';
import { packageRoot } from '../lib/packageRoot.js';
import { shellLine } from '../lib/shell.js';
import { SEAT_HEADER, SERVER_NAME } from '../mcp/constants.js';

import {
  carryOnLine,
  healPlan,
  isStalledStatus,
  keepsDyingLine,
  restartLine,
  stalledStatus,
  stopsOnErrorsLine,
} from './heal.js';
import { apiError, dialogKeys, typeIfClear, typePrompt, until, tmux as runTmux } from './tmux.js';

export const SESSION_PREFIX = 'messhall_';
export const SPAWN_DIR = 'spawn';
/** Where `<role>.settings.json` lives, next to the role briefs, so the user can edit what each role may run. */
export const PROFILES_DIR = path.join(packageRoot(), 'docs', 'briefs');
const SETTLE_MS = 1000;
const PANE_FORMAT = '#{session_name}\t#{pane_pid}';
// What tmux says when no server runs, so every session is gone. Any other failed listing says nothing.
const NO_SERVER = /no server running|error connecting/i;

const panePids = (listing: string) =>
  new Map(
    listing.split('\n').map(line => {
      const [session = '', pid = ''] = line.split('\t');
      return [session, Number(pid)] as const;
    }),
  );

interface Seat {
  name: string;
  room: string;
}

type Ready = 'dropped' | 'login' | 'seated' | 'timeout' | 'untrusted';

/** A seat stopped by an API error, until it moves: the status to put back, how many carry on lines went out, the
 * turn the last one answered, and whether the human was rung. */
interface Stall {
  before: string | null;
  rang: boolean;
  sends: number;
  sentTail: string | null;
}

/** True when the API answers at all, so a seat stopped by a network blip can carry on. */
const apiAnswersNow = () =>
  fetch(API_PROBE_URL, { method: 'HEAD', signal: AbortSignal.timeout(API_PROBE_MS) }).then(
    () => true,
    () => false,
  );

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

/** The prompt typed into a claude that messhall started again. It is a fresh session, so it reads its role again. */
export const healedPrompt = (seat: Seat & { role: string }) =>
  [
    `Your agent stopped and messhall started it again in the same seat.`,
    seatedPrompt(seat),
    `Call read_since for #${seat.room} to see what happened while you were gone.`,
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
  settings,
}: Seat & { agent: Launch['agent']; invite: string; mcpConfig: string; model?: string; settings?: string }) {
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
    ...(settings ? ['--settings', settings] : []),
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
  apiAnswers = apiAnswersNow,
  dataDir,
  now = () => new Date(),
  pollMs,
  profilesDir = PROFILES_DIR,
  readyWithinMs = SPAWN_READY_MS,
  settleMs = SETTLE_MS,
  shell = userInfo().shell ?? '/bin/zsh',
  store,
  tmux = runTmux,
  url,
}: {
  apiAnswers?: () => Promise<boolean>;
  dataDir: string;
  now?: () => Date;
  pollMs?: number;
  profilesDir?: string;
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

  // The role is a checked slug, so it can only name a file in this folder.
  const profileOf = (role: string) => {
    const file = path.join(profilesDir, `${role}.settings.json`);
    return existsSync(file) ? file : undefined;
  };

  // Every seat started from an invite and not left, with how it was launched.
  const spawnedSeats = (room?: string) =>
    (room ? [room] : store.listRooms().map(found => found.name)).flatMap(roomName =>
      store.listMembers(roomName).flatMap(member => {
        const seat = { name: member.name, room: roomName };
        const launch = store.launchOf(seat);
        return launch ? [{ launch, member, room: roomName, session: sessionName(seat) }] : [];
      }),
    );

  const presenceOf = ({ name, room }: Seat) => store.listMembers(room).find(member => member.name === name)?.presence;

  // Answers dialogs until the agent's first call takes the seat, or a login screen or the deadline stops it.
  // Only a seat the human asked for may trust its folder, since an agent picks the cwd of its own spawns.
  const waitSeated = async (
    seat: Seat,
    { taken, trust }: { taken: (presence: Presence) => boolean; trust: boolean },
  ) => {
    const target = exactTarget(seat);
    const ready = await until<Ready>(
      Date.now() + readyWithinMs,
      async () => {
        const presence = presenceOf(seat);
        if (!presence) return 'dropped';
        if (taken(presence)) return 'seated';
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

  // Sessions whose seat sat back down after a restart, so the healer knows the new agent took it.
  const rejoined = new Set<string>();
  let watches = new Map<string, Watch>();
  const healing = new Set<string>();
  const stalls = new Map<string, Stall>();
  const unsticking = new Set<string>();

  // A seat that left or was dropped must not keep its agent running. Only spawned seats have a session by this name.
  store.events.on(({ event }) => {
    if (event.type !== 'member') return;
    const seat = { name: event.member.name, room: event.room };
    if (event.change === 'reconnected') rejoined.add(sessionName(seat));
    if (event.change !== 'left' && event.change !== 'removed') return;
    stop(seat).catch((error: unknown) =>
      logger.error(error instanceof Error ? error : new Error(String(error)), { message: 'stopping a seat failed' }),
    );
  });

  // Codex has no seat header, so its seat key rides in its first prompt as the invite.
  const startAgent = ({
    launch,
    role,
    seat,
    seatKey,
  }: {
    launch: Launch;
    role: string;
    seat: Seat;
    seatKey: string;
  }) => {
    const { agent, cwd, model } = launch;
    const mcpConfig = configFile(seat);
    const argv = agentArgv({ ...seat, agent, invite: seatKey, mcpConfig, model, settings: profileOf(role) });
    if (agent === 'claude') writeConfig(seat, seatKey);
    return tmux(tmuxStartArgs({ argv, cwd, session: sessionName(seat), shell }));
  };

  const typeFirst = (seat: Seat, text: string) =>
    typePrompt(exactTarget(seat), text, { run: tmux, settleMs, titleWaitMs: readyWithinMs });

  const giveUp = async (seat: Seat) => {
    await stop(seat);
    store.removeMember({ member: seat.name, room: seat.room });
  };

  // Starts the agent again on the seat key it had, so it keeps its name, role and bookmark. A failed try kills the new
  // session and keeps the seat, so the next sweep can try again. Its folder was trusted at the first start.
  const restart = async ({ seat: { name, room, session }, try: n }: HealStep) => {
    const seat = { name, room };
    const launch = store.launchOf(seat);
    const seatKey = store.seatKeyOf(seat);
    const role = store.roleOf(seat)?.role;
    if (!launch || !seatKey || !role) return 'dropped';
    store.systemNote({ room, text: restartLine({ name, try: n }) });
    rejoined.delete(session);
    const started = await startAgent({ launch, role, seat, seatKey });
    if (started.code !== 0) return 'tmux';
    const ready = await waitSeated(seat, { taken: () => rejoined.has(session), trust: false });
    const typed = ready === 'seated' ? await typeFirst(seat, healedPrompt({ ...seat, role })) : ready;
    if (typed !== 'sent') await tmux(['kill-session', '-t', exactTarget(seat)]);
    return typed === 'sent' ? 'healed' : typed;
  };

  const healOne = async (step: HealStep) => {
    const { name, room, session } = step.seat;
    if (step.action === 'give_up') {
      store.systemNote({ ringHuman: true, room, text: keepsDyingLine({ name, room }) });
      return { name, outcome: 'gave_up', room } as const;
    }
    healing.add(session);
    try {
      return { name, outcome: await restart(step), room } as const;
    } finally {
      healing.delete(session);
    }
  };

  // Puts the seat's own status back once it moves, unless it set a new one meanwhile. A stalled status with no stall
  // here is left from before a daemon restart, so it is cleared.
  const moved = ({ name, room, session }: Seat & { session: string }, status: string | null) => {
    const stall = stalls.get(session);
    stalls.delete(session);
    if (isStalledStatus(status)) store.setStatus({ as: name, room, status: stall?.before ?? '' });
    return stall ? 'moved' : 'clear';
  };

  const unstickOne = async (
    { name, room, session, status }: Seat & { session: string; status: string | null },
    apiUp: () => Promise<boolean>,
  ) => {
    const target = exactTarget({ name, room });
    const pane = await tmux(['capture-pane', '-p', '-t', target]);
    const error = pane.code === 0 ? apiError(pane.stdout) : undefined;
    if (!error) return moved({ name, room, session }, status);
    const stall = stalls.get(session) ?? {
      before: isStalledStatus(status) ? null : status,
      rang: false,
      sends: 0,
      sentTail: null,
    };
    if (!stalls.has(session)) store.setStatus({ as: name, room, status: stalledStatus(error.reason) });
    stalls.set(session, stall);
    if (stall.sentTail === error.tail) return 'sent_before';
    if (stall.sends >= UNSTICK_TRIES) {
      if (stall.rang) return 'gave_up_before';
      stalls.set(session, { ...stall, rang: true });
      store.systemNote({ ringHuman: true, room, text: stopsOnErrorsLine({ name, room }) });
      return 'gave_up';
    }
    if (!(await apiUp())) return 'api_down';
    const typed = await typeIfClear(target, carryOnLine(room), { run: tmux, settleMs });
    if (typed === 'sent') stalls.set(session, { ...stall, sends: stall.sends + 1, sentTail: error.tail });
    return typed;
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
      await stop(seat);
      const started = await startAgent({ launch, role, seat, seatKey: invited.seatKey });
      if (started.code !== 0) {
        await giveUp(seat);
        return { detail: started.stderr.trim(), ok: false, reason: 'tmux' } as const;
      }
      const ready = await waitSeated(seat, { taken: presence => presence !== 'invited', trust: by === HUMAN_NAME });
      if (ready !== 'seated') {
        await giveUp(seat);
        return { ok: false, reason: ready } as const;
      }
      if (launch.agent === 'claude') {
        const typed = await typeFirst(seat, seatedPrompt({ ...seat, role }));
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

    /** Restarts each watched spawned seat whose tmux session is gone, after `held` says no mcp session holds it.
     * Backs off between tries and rings the human once they run out. Called on the sweep, so it skips a restart in flight. */
    async heal({ held }: { held: (seat: Seat) => boolean }) {
      const listed = await tmux(['list-sessions', '-F', '#{session_name}']);
      if (listed.code !== 0 && !NO_SERVER.test(listed.stderr)) return [];
      const running = new Set(listed.stdout.split('\n'));
      const closed = new Set(store.listRooms().flatMap(room => (room.closed_at === null ? [] : [room.name])));
      const seats = spawnedSeats().map(({ launch, member, room, session }): HealSeat => ({
        agent: launch.agent,
        alive: running.has(session) || healing.has(session),
        closed: closed.has(room),
        done: member.done,
        held: held({ name: member.name, room }),
        name: member.name,
        presence: member.presence,
        room,
        session,
      }));
      const plan = healPlan({ now: now().getTime(), seats, watches });
      watches = plan.watches;
      return Promise.all(plan.steps.map(healOne));
    },

    /** Finds spawned claude seats whose last turn ended in an API error, shows each as stalled, and once the API
     * answers types one carry on line, at most once per error. After `UNSTICK_TRIES` lines with no move between them
     * it rings the human once and stops. Asks the API at most once per call. */
    async unstick() {
      const closed = new Set(store.listRooms().flatMap(room => (room.closed_at === null ? [] : [room.name])));
      let probe: Promise<boolean> | undefined;
      const apiUp = () => {
        probe ??= apiAnswers();
        return probe;
      };
      const spawned = spawnedSeats();
      const kept = new Set(spawned.map(({ session }) => session));
      [...stalls.keys()].filter(session => !kept.has(session)).forEach(session => stalls.delete(session));
      const seats = spawned.filter(
        ({ launch, member, room, session }) =>
          launch.agent === 'claude' &&
          !closed.has(room) &&
          !member.done &&
          member.presence !== 'invited' &&
          !healing.has(session) &&
          !unsticking.has(session),
      );
      return Promise.all(
        seats.map(async ({ member, room, session }) => {
          unsticking.add(session);
          try {
            const seat = { name: member.name, room, session, status: member.status };
            return { name: member.name, outcome: await unstickOne(seat, apiUp), room };
          } finally {
            unsticking.delete(session);
          }
        }),
      );
    },

    /** Every seat started from an invite, in `room` or in every room, with its session and whether it runs. */
    async list({ room }: { room?: string }) {
      const pids = panePids((await tmux(['list-panes', '-a', '-F', PANE_FORMAT])).stdout);
      return spawnedSeats(room).map(({ launch, member, room: roomName, session }): FlockSeat => {
        const pid = pids.get(session) ?? null;
        return {
          agent: launch.agent,
          cwd: launch.cwd,
          name: member.name,
          pid,
          presence: member.presence,
          process: pid === null ? 'gone' : 'running',
          role: member.role,
          room: roomName,
          session,
        };
      });
    },
  };
}

export type Spawner = ReturnType<typeof createSpawner>;
