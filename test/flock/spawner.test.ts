import type { Tmux } from '../../src/flock/tmux.js';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentArgv, createSpawner, sessionName, tmuxStartArgs } from '../../src/flock/spawner.js';
import { shellLine } from '../../src/lib/shell.js';
import { scratchStore } from '../rooms/scratch.js';

const CHANNELS = `WARNING: Loading development channels
 ❯ 1. Exit
   2. I am using this for local development`;
const LOGIN = 'Select login method:\n ❯ 1. Claude account with subscription';
const HOSTILE = "$(touch /tmp/pwned) `id` ' ; rm -rf ~";

let scratch: ReturnType<typeof scratchStore>;
let cwd: string;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.createRoom({ created_by: 'human', name: 'demo' });
  cwd = mkdtempSync(path.join(tmpdir(), 'messhall-spawn-cwd-'));
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
const seatKeyIn = (args: string[]) => args[args.indexOf('-e') + 1]?.replace('MESSHALL_SEAT=', '');
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
    if (args[0] === 'send-keys' && !args.includes('-l')) {
      screen = '';
      onAnswer?.();
    }
    return Promise.resolve(result());
  });
}

const spawner = (tmux: Tmux) =>
  createSpawner({ pollMs: 1, readyWithinMs: 50, settleMs: 0, shell: '/bin/zsh', store: store(), tmux });

const spawnApi = (tmux: Tmux, input: { agent?: 'claude' | 'codex'; cwd?: string; instructions?: string } = {}) =>
  spawner(tmux).spawn({
    by: 'human',
    instructions: input.instructions,
    launch: { agent: input.agent ?? 'claude', cwd: input.cwd ?? cwd, model: 'opus' },
    name: 'api',
    role: 'worker',
    room: 'demo',
  });

describe('agentArgv', () => {
  it('starts claude with the messhall channel, its tools allowed and the model', () => {
    expect(agentArgv({ agent: 'claude', invite: 'key-1', model: 'opus', name: 'api', room: 'demo' })).toStrictEqual([
      'claude',
      '--dangerously-load-development-channels',
      'server:messhall',
      '--allowedTools',
      'mcp__messhall',
      '--model',
      'opus',
    ]);
  });

  it('keeps the seat key out of the claude argv, since claude sends it from its env', () => {
    expect(agentArgv({ agent: 'claude', invite: 'key-1', name: 'api', room: 'demo' }).join(' ')).not.toContain('key-1');
  });

  it('starts codex with a first prompt that joins with the invite and reads the role', () => {
    const argv = agentArgv({ agent: 'codex', invite: 'key-1', model: 'gpt-6', name: 'api', room: 'demo' });

    expect(argv.slice(0, 3)).toStrictEqual(['codex', '--model', 'gpt-6']);
    expect(argv[3]).toContain('join #demo as api');
    expect(argv[3]).toContain('invite set to key-1');
    expect(argv[3]).toContain('my_role');
  });
});

describe('tmuxStartArgs', () => {
  it('runs the argv in a login shell in a detached session in cwd, with the seat key in its env', () => {
    const argv = ['claude', '--model', 'opus'];

    expect(
      tmuxStartArgs({ argv, cwd: '/work/api', seatKey: 'key-1', session: 'messhall-demo-api', shell: '/bin/zsh' }),
    ).toStrictEqual([
      'new-session',
      '-d',
      '-s',
      'messhall-demo-api',
      '-x',
      '200',
      '-y',
      '50',
      '-c',
      '/work/api',
      '-e',
      'MESSHALL_SEAT=key-1',
      shellLine(['/bin/zsh', '-lic', shellLine(argv)]),
    ]);
  });
});

describe('createSpawner', () => {
  it('names the session after the room and the seat', () => {
    expect(sessionName({ name: 'api', room: 'demo' })).toBe('messhall-demo-api');
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

  it('answers the dialog, waits for the seat to be taken, then types the first prompt', async () => {
    let key: string | undefined;
    const tmux = fakeTmux({
      onAnswer: () => store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: key }),
      onStart: args => {
        key = seatKeyIn(args);
      },
      pane: CHANNELS,
    });

    const outcome = await spawnApi(tmux);

    expect(outcome).toMatchObject({ ok: true, session: 'messhall-demo-api' });
    expect(memberOf('api')).toMatchObject({ presence: 'active', role: 'worker' });
    const sent = calls(tmux).filter(args => args[0] === 'send-keys');
    expect(sent[0]).toStrictEqual(['send-keys', '-t', 'messhall-demo-api', 'Down', 'Enter']);
    expect(sent[1]?.slice(0, 4)).toStrictEqual(['send-keys', '-t', 'messhall-demo-api', '-l']);
    expect(sent[1]?.[4]).toContain('call my_role');
  });

  it('starts codex with no seat key in its env and waits for its join with the invite', async () => {
    const tmux = fakeTmux({
      onStart: args => {
        const invite = /invite set to (\S+?)\./.exec(args.at(-1) ?? '')?.[1];
        store().joinRoom({ as: 'api', invite, kind: 'codex', room: 'demo', seatKey: 'thread-1' });
      },
    });

    const outcome = await spawnApi(tmux, { agent: 'codex' });

    expect(outcome).toMatchObject({ ok: true });
    expect(calls(tmux).find(args => args[0] === 'new-session')).not.toContain('-e');
    expect(calls(tmux).some(args => args.includes('-l'))).toBe(false);
  });

  it('never puts the instructions in any tmux call', async () => {
    let key: string | undefined;
    const tmux = fakeTmux({
      onStart: args => {
        key = seatKeyIn(args);
        store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: key });
      },
    });

    await spawnApi(tmux, { instructions: HOSTILE });

    expect(calls(tmux).flat().join('\n')).not.toContain('touch /tmp/pwned');
    expect(store().roleOf({ name: 'api', room: 'demo' })).toMatchObject({ instructions: HOSTILE });
  });

  it('kills the session and drops the invite when the seat is never taken', async () => {
    const tmux = fakeTmux({});

    const outcome = await spawnApi(tmux);

    expect(outcome).toStrictEqual({ ok: false, reason: 'timeout' });
    expect(calls(tmux).at(-1)).toStrictEqual(['kill-session', '-t', 'messhall-demo-api']);
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

    expect(calls(tmux)).toStrictEqual([['kill-session', '-t', 'messhall-demo-api']]);
  });

  it('lists spawned seats with their session and whether it still runs', async () => {
    store().invite({ by: 'human', launch: { agent: 'claude', cwd }, name: 'api', role: 'worker', room: 'demo' });
    store().invite({ by: 'human', launch: { agent: 'codex', cwd }, name: 'web', role: 'reviewer', room: 'demo' });
    store().joinRoom({ as: 'loose', kind: 'claude', room: 'demo' });
    const tmux = vi.fn<Tmux>(() => Promise.resolve(result('messhall-demo-api\t4242\nother\t1\n')));

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
        session: 'messhall-demo-api',
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
        session: 'messhall-demo-web',
      },
    ]);
  });
});
