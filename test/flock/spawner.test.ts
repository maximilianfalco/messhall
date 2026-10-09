import type { Tmux } from '../../src/flock/tmux.js';

import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadKeys } from '../../src/daemon/keys.js';
import { agentArgv, createSpawner, sessionName, tmuxStartArgs } from '../../src/flock/spawner.js';
import { parseStoredJson } from '../../src/lib/json.js';
import { shellLine } from '../../src/lib/shell.js';
import { scratchStore, seatOrchestrator } from '../rooms/scratch.js';

const CHANNELS = `WARNING: Loading development channels
 ❯ 1. Exit
   2. I am using this for local development`;
const TRUST_PANE = ' ❯ 1. Yes, I trust this folder\n   2. No, exit';
const LOGIN = 'Select login method:\n ❯ 1. Claude account with subscription';
const HOSTILE = "$(touch /tmp/pwned) `id` ' ; rm -rf ~";

let scratch: ReturnType<typeof scratchStore>;
let cwd: string;
let profiles: string;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.createRoom({ created_by: 'human', name: 'demo' });
  loadKeys({ dataDir: scratch.dataDir });
  cwd = mkdtempSync(path.join(tmpdir(), 'messhall-spawn-cwd-'));
  profiles = mkdtempSync(path.join(tmpdir(), 'messhall-spawn-profiles-'));
  writeFileSync(path.join(profiles, 'worker.settings.json'), '{}');
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;
const result = (stdout = '', code = 0) => ({ code, stderr: code ? 'tmux said no' : '', stdout });
const memberOf = (name: string) =>
  store()
    .listMembers('demo')
    .find(member => member.name === name);
const configFile = () => path.join(scratch.dataDir, 'spawn', 'demo_api-mcp.json');
const seatKeyInConfig = () =>
  (
    parseStoredJson(readFileSync(configFile(), 'utf8')) as {
      mcpServers: { messhall: { headers: Record<string, string>; url: string } };
    }
  ).mcpServers.messhall;
const calls = (tmux: ReturnType<typeof vi.fn<Tmux>>) => tmux.mock.calls.map(([args]) => args);

function fakeTmux({
  onAnswer,
  onStart,
  pane = '',
  started = 0,
}: {
  onAnswer?: () => void;
  onStart?: (args: string[]) => void;
  pane?: string;
  started?: number;
}) {
  let screen = pane;
  return vi.fn<Tmux>(args => {
    if (args[0] === 'new-session') {
      onStart?.(args);
      return Promise.resolve(result('', started));
    }
    if (args[0] === 'capture-pane') return Promise.resolve(result(args.includes('-e') ? '' : screen));
    if (args[0] === 'display-message') return Promise.resolve(result('✳ Claude Code\n'));
    if (args[0] === 'send-keys' && !args.includes('-l')) {
      screen = '';
      onAnswer?.();
    }
    return Promise.resolve(result());
  });
}

const spawner = (tmux: Tmux) =>
  createSpawner({
    dataDir: scratch.dataDir,
    pollMs: 1,
    profilesDir: profiles,
    readyWithinMs: 50,
    settleMs: 0,
    shell: '/bin/zsh',
    store: store(),
    tmux,
    url: 'http://127.0.0.1:7791',
  });
const seatFromConfig = () =>
  store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: seatKeyInConfig().headers['x-messhall-seat'] });

const spawnApi = (
  tmux: Tmux,
  input: { agent?: 'claude' | 'codex'; cwd?: string; instructions?: string; role?: string } = {},
) =>
  spawner(tmux).spawn({
    by: 'human',
    instructions: input.instructions,
    launch: { agent: input.agent ?? 'claude', cwd: input.cwd ?? cwd, model: 'opus' },
    name: 'api',
    role: input.role ?? 'worker',
    room: 'demo',
  });

describe('agentArgv', () => {
  it('starts claude on its own mcp config with the messhall channel, its tools allowed and the model', () => {
    expect(
      agentArgv({
        agent: 'claude',
        invite: 'key-1',
        mcpConfig: '/d/spawn/demo_api-mcp.json',
        model: 'opus',
        name: 'api',
        room: 'demo',
      }),
    ).toStrictEqual([
      'claude',
      '--mcp-config',
      '/d/spawn/demo_api-mcp.json',
      '--dangerously-load-development-channels',
      'server:messhall',
      '--allowedTools',
      'mcp__messhall',
      '--model',
      'opus',
    ]);
  });

  it('passes the role settings profile to claude when there is one', () => {
    const argv = agentArgv({
      agent: 'claude',
      invite: 'key-1',
      mcpConfig: '/d/c.json',
      name: 'api',
      room: 'demo',
      settings: '/briefs/worker.settings.json',
    });

    expect(argv.slice(-2)).toStrictEqual(['--settings', '/briefs/worker.settings.json']);
  });

  it('keeps the seat key out of the claude argv, since claude sends it from its mcp config', () => {
    const argv = agentArgv({ agent: 'claude', invite: 'key-1', mcpConfig: '/d/c.json', name: 'api', room: 'demo' });

    expect(argv.join(' ')).not.toContain('key-1');
  });

  it('starts codex with a first prompt that joins with the invite and reads the role', () => {
    const argv = agentArgv({
      agent: 'codex',
      invite: 'key-1',
      mcpConfig: '/d/c.json',
      model: 'gpt-6',
      name: 'api',
      room: 'demo',
    });

    expect(argv.slice(0, 3)).toStrictEqual(['codex', '--model', 'gpt-6']);
    expect(argv[3]).toContain('join #demo as api');
    expect(argv[3]).toContain('invite set to key-1');
    expect(argv[3]).toContain('my_role');
  });
});

describe('tmuxStartArgs', () => {
  it('runs the argv in a login shell in a detached session in cwd', () => {
    const argv = ['claude', '--model', 'opus'];

    expect(tmuxStartArgs({ argv, cwd: '/work/api', session: 'messhall_demo_api', shell: '/bin/zsh' })).toStrictEqual([
      'new-session',
      '-d',
      '-s',
      'messhall_demo_api',
      '-x',
      '200',
      '-y',
      '50',
      '-c',
      '/work/api',
      shellLine(['/bin/zsh', '-lic', shellLine(argv)]),
    ]);
  });
});

describe('createSpawner', () => {
  it('names the session after the room and the seat', () => {
    expect(sessionName({ name: 'api', room: 'demo' })).toBe('messhall_demo_api');
  });

  it('gives two rooms whose names run together their own sessions', () => {
    expect(sessionName({ name: 'c', room: 'a-b' })).not.toBe(sessionName({ name: 'b-c', room: 'a' }));
  });

  it('targets its own session exactly in every tmux call after the start, never a prefix match', async () => {
    const tmux = fakeTmux({ onAnswer: seatFromConfig, pane: CHANNELS });

    await spawnApi(tmux);
    await spawner(tmux).stop({ name: 'api', room: 'demo' });

    const targets = calls(tmux)
      .filter(args => !['new-session', 'set-buffer'].includes(args[0]!))
      .map(args => args[args.indexOf('-t') + 1]);
    expect(new Set(targets)).toStrictEqual(new Set(['=messhall_demo_api:']));
  });

  it('trusts the folder when the human spawns', async () => {
    const tmux = fakeTmux({ onAnswer: seatFromConfig, pane: TRUST_PANE });

    const outcome = await spawnApi(tmux);

    expect(outcome).toMatchObject({ ok: true });
    expect(calls(tmux)).toContainEqual(['send-keys', '-t', '=messhall_demo_api:', 'Enter']);
  });

  it('never trusts a folder for an orchestrator, and drops the seat', async () => {
    store().joinRoom({ as: 'boss', kind: 'claude', room: 'demo' });
    store().assignRole({ by: 'human', member: 'boss', role: 'orchestrator', room: 'demo' });
    const tmux = fakeTmux({ onAnswer: seatFromConfig, pane: TRUST_PANE });

    const outcome = await spawner(tmux).spawn({
      by: 'boss',
      launch: { agent: 'claude', cwd },
      name: 'api',
      role: 'worker',
      room: 'demo',
    });

    expect(outcome).toStrictEqual({ ok: false, reason: 'untrusted' });
    expect(calls(tmux).some(args => args[0] === 'send-keys')).toBe(false);
    expect(memberOf('api')).toBeUndefined();
  });

  it('refuses a cwd that is not a folder before any invite or tmux call', async () => {
    const tmux = fakeTmux({});

    const outcome = await spawnApi(tmux, { cwd: path.join(cwd, 'missing') });

    expect(outcome).toStrictEqual({ ok: false, reason: 'no_cwd' });
    expect(memberOf('api')).toBeUndefined();
    expect(tmux).not.toHaveBeenCalled();
  });

  it('refuses a relative cwd', async () => {
    const outcome = await spawnApi(fakeTmux({}), { cwd: 'api' });

    expect(outcome).toStrictEqual({ ok: false, reason: 'no_cwd' });
  });

  it('answers the dialog, waits for the seat to be taken, then pastes the first prompt', async () => {
    const tmux = fakeTmux({ onAnswer: seatFromConfig, pane: CHANNELS });

    const outcome = await spawnApi(tmux);

    expect(outcome).toMatchObject({ ok: true, session: 'messhall_demo_api' });
    expect(memberOf('api')).toMatchObject({ presence: 'active', role: 'worker' });
    const sent = calls(tmux).filter(args => ['paste-buffer', 'send-keys', 'set-buffer'].includes(args[0]!));
    expect(sent[0]).toStrictEqual(['send-keys', '-t', '=messhall_demo_api:', 'Down', 'Enter']);
    expect(sent[1]?.[0]).toBe('set-buffer');
    expect(sent[1]?.at(-1)).toContain('call my_role');
    expect(sent[2]?.slice(0, 3)).toStrictEqual(['paste-buffer', '-p', '-d']);
    expect(sent[2]?.slice(-2)).toStrictEqual(['-t', '=messhall_demo_api:']);
  });

  it('drops the seat when the pane never shows claude in its title, typing nothing', async () => {
    const tmux = vi.fn<Tmux>(args => {
      if (args[0] === 'new-session') seatFromConfig();
      return Promise.resolve(result(args[0] === 'display-message' ? 'zsh\n' : ''));
    });

    const outcome = await spawnApi(tmux);

    expect(outcome).toStrictEqual({ ok: false, reason: 'not_ready' });
    expect(calls(tmux).some(args => args.includes('-l') || args[0] === 'paste-buffer')).toBe(false);
    expect(memberOf('api')).toBeUndefined();
  });

  it('writes the seat mcp config 0600 with this daemon url, the agent key and the seat key', async () => {
    await spawnApi(fakeTmux({ onStart: seatFromConfig }));

    const server = seatKeyInConfig();
    expect(statSync(configFile()).mode.toString(8).slice(-3)).toBe('600');
    expect(server.url).toBe('http://127.0.0.1:7791/mcp');
    expect(server.headers['x-messhall-key']).toBe(readFileSync(path.join(scratch.dataDir, 'agent-key'), 'utf8').trim());
    expect(store().seatsOf(server.headers['x-messhall-seat']!)).toMatchObject([{ name: 'api', room: 'demo' }]);
  });

  it('starts codex with no mcp config file and waits for its join with the invite', async () => {
    const tmux = fakeTmux({
      onStart: args => {
        const invite = /invite set to (\S+?)\./.exec(args.at(-1) ?? '')?.[1];
        store().joinRoom({ as: 'api', invite, kind: 'codex', room: 'demo', seatKey: 'thread-1' });
      },
    });

    const outcome = await spawnApi(tmux, { agent: 'codex' });

    expect(outcome).toMatchObject({ ok: true });
    expect(existsSync(configFile())).toBe(false);
    expect(calls(tmux).some(args => args.includes('-l'))).toBe(false);
  });

  it('starts claude with the settings profile named after its role', async () => {
    const tmux = fakeTmux({ onStart: seatFromConfig });
    await spawnApi(tmux);
    const started = calls(tmux).find(args => args[0] === 'new-session');

    expect(started?.at(-1)).toContain(`--settings ${path.join(profiles, 'worker.settings.json')}`);
  });

  it('starts claude with no settings profile when its role has none', async () => {
    const tmux = fakeTmux({ onStart: seatFromConfig });
    await spawnApi(tmux, { role: 'observer' });
    const started = calls(tmux).find(args => args[0] === 'new-session');

    expect(started?.at(-1)).not.toContain('--settings');
  });

  it('never puts the instructions in any tmux call', async () => {
    const tmux = fakeTmux({ onStart: seatFromConfig });

    await spawnApi(tmux, { instructions: HOSTILE });

    expect(calls(tmux).flat().join('\n')).not.toContain('touch /tmp/pwned');
    expect(store().roleOf({ name: 'api', room: 'demo' })).toMatchObject({ instructions: HOSTILE });
  });

  it('kills the session, removes the config and drops the invite when the seat is never taken', async () => {
    const tmux = fakeTmux({});

    const outcome = await spawnApi(tmux);

    expect(outcome).toStrictEqual({ ok: false, reason: 'timeout' });
    expect(calls(tmux).at(-1)).toStrictEqual(['kill-session', '-t', '=messhall_demo_api:']);
    expect(existsSync(configFile())).toBe(false);
    expect(memberOf('api')).toBeUndefined();
  });

  it('stops on a login screen and drops the invite', async () => {
    const outcome = await spawnApi(fakeTmux({ pane: LOGIN }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'login' });
    expect(memberOf('api')).toBeUndefined();
  });

  it('drops the invite when tmux cannot start the session', async () => {
    const outcome = await spawnApi(fakeTmux({ started: 1 }));

    expect(outcome).toStrictEqual({ detail: 'tmux said no', ok: false, reason: 'tmux' });
    expect(memberOf('api')).toBeUndefined();
  });

  it('passes a taken name back from the invite without starting anything', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    const tmux = fakeTmux({});

    const outcome = await spawnApi(tmux);

    expect(outcome).toMatchObject({ ok: false, reason: 'name_taken', suggestion: 'api-2' });
    expect(tmux).not.toHaveBeenCalled();
  });

  it('stops a seat by killing its session', async () => {
    const tmux = fakeTmux({});

    await spawner(tmux).stop({ name: 'api', room: 'demo' });

    expect(calls(tmux)).toStrictEqual([['kill-session', '-t', '=messhall_demo_api:']]);
  });

  it('lists spawned seats with their session and whether it still runs', async () => {
    store().invite({ by: 'human', launch: { agent: 'claude', cwd }, name: 'api', role: 'worker', room: 'demo' });
    store().invite({ by: 'human', launch: { agent: 'codex', cwd }, name: 'web', role: 'reviewer', room: 'demo' });
    store().joinRoom({ as: 'loose', kind: 'claude', room: 'demo' });
    const tmux = vi.fn<Tmux>(() => Promise.resolve(result('messhall_demo_api\t4242\nother\t1\n')));

    const seats = await spawner(tmux).list({});

    expect(seats).toStrictEqual([
      {
        agent: 'claude',
        cwd,
        name: 'api',
        pid: 4242,
        presence: 'invited',
        process: 'running',
        role: 'worker',
        room: 'demo',
        session: 'messhall_demo_api',
      },
      {
        agent: 'codex',
        cwd,
        name: 'web',
        pid: null,
        presence: 'invited',
        process: 'gone',
        role: 'reviewer',
        room: 'demo',
        session: 'messhall_demo_web',
      },
    ]);
  });
});

describe('a seat that goes', () => {
  function liveSessions() {
    const sessions = new Set<string>();
    const tmux = vi.fn<Tmux>(args => {
      if (args[0] === 'kill-session') sessions.delete(String(args[2]).slice(1, -1));
      return Promise.resolve(result());
    });
    return { sessions, tmux };
  }

  function spawnedSeat(name: string) {
    const invited = store().invite({
      by: 'human',
      launch: { agent: 'claude', cwd },
      name,
      role: 'worker',
      room: 'demo',
    });
    if (!invited.ok) throw new Error(invited.reason);
    store().joinRoom({ as: name, kind: 'claude', room: 'demo', seatKey: invited.seatKey });
  }

  it('stops the tmux session of a spawned seat that leaves', () => {
    const { sessions, tmux } = liveSessions();
    spawner(tmux);
    spawnedSeat('api');
    sessions.add('messhall_demo_api');

    store().leaveRoom({ as: 'api', note: 'merged', room: 'demo' });

    expect(sessions).toStrictEqual(new Set());
  });

  it('stops the tmux session of a spawned seat that is kicked', () => {
    const { sessions, tmux } = liveSessions();
    spawner(tmux);
    seatOrchestrator(store());
    spawnedSeat('api');
    sessions.add('messhall_demo_api');

    store().kickMember({ by: 'orchestrator', member: 'api', room: 'demo' });

    expect(sessions).toStrictEqual(new Set());
  });

  it('stops the tmux session of a done spawned seat that leaves on its own', () => {
    const { sessions, tmux } = liveSessions();
    spawner(tmux);
    spawnedSeat('api');
    store().joinRoom({ as: 'web', kind: 'claude', room: 'demo' });
    sessions.add('messhall_demo_api');
    store().postMessage({ done: true, from: 'api', room: 'demo', text: 'merged' });
    scratch.clock.advance(61 * 60_000);
    store().sweepPresence({ ringable: () => false });

    store().leaveDoneAway();

    expect(sessions).toStrictEqual(new Set());
  });

  it('stops no other session when a hand started seat leaves', () => {
    const { sessions, tmux } = liveSessions();
    spawner(tmux);
    spawnedSeat('api');
    store().joinRoom({ as: 'web', kind: 'claude', room: 'demo' });
    sessions.add('messhall_demo_api');

    store().leaveRoom({ as: 'web', room: 'demo' });

    expect(sessions).toStrictEqual(new Set(['messhall_demo_api']));
    expect(calls(tmux).flat()).not.toContain('=messhall_demo_api:');
  });
});

describe('healing a spawned seat', () => {
  const NO_SERVER = 'no server running on /private/tmp/tmux-501/default';

  function flock({ pane = '', rejoins = true }: { pane?: string; rejoins?: boolean } = {}) {
    const sessions = new Set<string>();
    let listFails = '';
    const tmux = vi.fn<Tmux>(args => {
      const [command] = args;
      if (command === 'list-sessions') {
        if (listFails) return Promise.resolve({ code: 1, stderr: listFails, stdout: '' });
        return Promise.resolve(result([...sessions].join('\n')));
      }
      if (command === 'new-session') {
        sessions.add(String(args[args.indexOf('-s') + 1]));
        if (rejoins) {
          const seatKey = seatKeyInConfig().headers['x-messhall-seat'];
          store().joinRoom({ as: 'api', kind: 'claude', reattach: true, room: 'demo', seatKey });
        }
        return Promise.resolve(result());
      }
      if (command === 'kill-session') sessions.delete(String(args[2]).slice(1, -1));
      if (command === 'capture-pane' && !args.includes('-e')) return Promise.resolve(result(pane));
      if (command === 'display-message') return Promise.resolve(result('✳ Claude Code\n'));
      return Promise.resolve(result());
    });
    const healer = createSpawner({
      dataDir: scratch.dataDir,
      now: scratch.clock.now,
      pollMs: 1,
      profilesDir: profiles,
      readyWithinMs: 50,
      settleMs: 0,
      shell: '/bin/zsh',
      store: store(),
      tmux,
      url: 'http://127.0.0.1:7791',
    });
    return {
      die: () => sessions.clear(),
      failListing: (stderr: string) => {
        listFails = stderr;
      },
      heal: (held = false) => healer.heal({ held: () => held }),
      sessions,
      tmux,
    };
  }

  function seatApi() {
    const invited = store().invite({
      by: 'human',
      launch: { agent: 'claude', cwd },
      name: 'api',
      role: 'worker',
      room: 'demo',
    });
    if (!invited.ok) throw new Error(invited.reason);
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: invited.seatKey });
    return invited.seatKey;
  }

  const starts = (tmux: ReturnType<typeof vi.fn<Tmux>>) => calls(tmux).filter(args => args[0] === 'new-session');
  const systemLines = () =>
    store()
      .listMessages({ limit: 50, room: 'demo' })
      .messages?.filter(message => message.kind === 'system')
      .map(message => message.text) ?? [];

  async function watchedThenDead(seats = flock()) {
    const key = seatApi();
    seats.sessions.add('messhall_demo_api');
    await seats.heal();
    seats.die();
    return { key, seats };
  }

  it('restarts a seat whose session died on the same seat key, keeping its role', async () => {
    const { key, seats } = await watchedThenDead();

    const outcomes = await seats.heal();

    expect(outcomes).toStrictEqual([{ name: 'api', outcome: 'healed', room: 'demo' }]);
    expect(seatKeyInConfig().headers['x-messhall-seat']).toBe(key);
    expect(memberOf('api')).toMatchObject({ presence: 'active', role: 'worker' });
    expect(systemLines()).toContain('api stopped, messhall is starting it again (try 1 of 3)');
    expect(
      calls(seats.tmux)
        .find(args => args[0] === 'set-buffer')
        ?.at(-1),
    ).toContain('started it again');
  });

  it('starts the agent with its role profile', async () => {
    const { seats } = await watchedThenDead();

    await seats.heal();

    expect(starts(seats.tmux)[0]?.at(-1)).toContain(`--settings ${path.join(profiles, 'worker.settings.json')}`);
  });

  it('never answers a trust prompt on a restart', async () => {
    const { seats } = await watchedThenDead(flock({ pane: TRUST_PANE, rejoins: false }));

    const outcomes = await seats.heal();

    expect(outcomes).toStrictEqual([{ name: 'api', outcome: 'untrusted', room: 'demo' }]);
    expect(calls(seats.tmux).some(args => args[0] === 'send-keys')).toBe(false);
  });

  it('waits while an mcp session still holds the seat', async () => {
    const { seats } = await watchedThenDead();

    await seats.heal(true);

    expect(starts(seats.tmux)).toStrictEqual([]);
  });

  it('kills the new session and keeps the seat when the agent never sits back down', async () => {
    const { seats } = await watchedThenDead(flock({ rejoins: false }));

    const outcomes = await seats.heal();

    expect(outcomes).toStrictEqual([{ name: 'api', outcome: 'timeout', room: 'demo' }]);
    expect(seats.sessions).toStrictEqual(new Set());
    expect(memberOf('api')).toBeDefined();
  });

  it('rings the human once when restarts run out, then stops', async () => {
    const { seats } = await watchedThenDead(flock({ rejoins: false }));

    const healEvery10Minutes = async (times: number): Promise<void> => {
      if (!times) return;
      await seats.heal();
      scratch.clock.advance(10 * 60_000);
      return healEvery10Minutes(times - 1);
    };

    await healEvery10Minutes(5);

    expect(starts(seats.tmux)).toHaveLength(3);
    const keepsDying = store()
      .listMessages({ limit: 50, room: 'demo' })
      .messages?.filter(message => message.text.includes('keeps dying'));
    expect(keepsDying).toMatchObject([
      {
        mentions: ['human'],
        text: '@human api keeps dying in #demo, messhall stopped restarting it. start it again or kick it',
      },
    ]);
  });

  it('never restarts a seat that left', async () => {
    const { seats } = await watchedThenDead();
    store().leaveRoom({ as: 'api', room: 'demo' });

    await seats.heal();

    expect(starts(seats.tmux)).toStrictEqual([]);
  });

  it('never restarts a seat in a room the human closed', async () => {
    const { seats } = await watchedThenDead();
    store().closeRoom('demo');

    await seats.heal();

    expect(starts(seats.tmux)).toStrictEqual([]);
  });

  it('reads a failed listing as no news, unless no tmux server runs at all', async () => {
    const { seats } = await watchedThenDead();
    seats.failListing('lost server');

    await seats.heal();
    expect(starts(seats.tmux)).toStrictEqual([]);

    seats.failListing(NO_SERVER);
    await seats.heal();
    expect(starts(seats.tmux)).toHaveLength(1);
  });
});
