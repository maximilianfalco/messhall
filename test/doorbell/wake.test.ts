import type { RunResult } from '../../src/lib/run.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { menuOpen, tmuxSeats, wakeList, wakeSeats, wakeText } from '../../src/doorbell/wake.js';
import { SEAT_HEADER, SERVER_NAME } from '../../src/mcp/constants.js';

const SPAWN_DIR = '/Users/me/Library/Application Support/messhall/spawn';
const IDLE_PANE = ' ────────\n ❯ \n ────────\n  ⏵⏵ auto mode on';
const MENU_PANE = ' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';

const result = (stdout = ''): RunResult => ({ code: 0, stderr: '', stdout });
const seat = (name: string, kind: 'claude' | 'codex' | 'other', seatKey: string | null, room = 'dev') => ({
  kind,
  name,
  room,
  seatKey,
});

describe('tmuxSeats', () => {
  it('maps each pane started with an mcp config in the spawn dir to the seat key in that config', () => {
    const listing = [
      `messhall-B106\tclaude --mcp-config '${SPAWN_DIR}/B106-mcp.json' --strict-mcp-config`,
      `messhall_dev_api\t/bin/zsh -lic "claude --mcp-config '\\''${SPAWN_DIR}/dev_api-mcp.json'\\'' --allowedTools"`,
      `scratch\tclaude --mcp-config '/tmp/other/spawn/x-mcp.json'`,
      `shell\t/bin/zsh`,
    ].join('\n');
    const keys: Record<string, string> = { 'B106-mcp.json': 'seat-b106', 'dev_api-mcp.json': 'seat-api' };

    const found = tmuxSeats({ listing, readSeatKey: file => keys[path.basename(file)], spawnDir: SPAWN_DIR });

    expect(found).toStrictEqual(
      new Map([
        ['seat-b106', 'messhall-B106'],
        ['seat-api', 'messhall_dev_api'],
      ]),
    );
  });
});

describe('wakeList', () => {
  it('wakes a claude through its tmux session and a codex through its thread, once per seat key', () => {
    const seats = [
      seat('f10-wake', 'claude', 'seat-b106'),
      seat('f10-wake', 'claude', 'seat-b106', 'ops'),
      seat('web', 'codex', 'thread-1'),
      seat('by-hand', 'claude', 'tok-1'),
      seat('ios', 'other', 'seat-ios'),
      seat('keyless', 'codex', null),
    ];

    const list = wakeList({ seats, tmux: new Map([['seat-b106', 'messhall-B106']]) });

    expect(list).toStrictEqual([
      { channel: 'tmux', names: ['f10-wake'], rooms: ['dev', 'ops'], target: 'messhall-B106' },
      { channel: 'codex', names: ['web'], rooms: ['dev'], target: 'thread-1' },
    ]);
  });
});

describe('wakeText', () => {
  it('names every room to read', () => {
    expect(wakeText(['dev', 'ops'])).toBe(
      'messhall restarted. call read_since on #dev and #ops, then carry on with your work.',
    );
  });
});

describe('menuOpen', () => {
  it('sees a numbered menu or a dialog footer, not an empty input box', () => {
    expect(menuOpen(MENU_PANE)).toBe(true);
    expect(menuOpen(' ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel')).toBe(true);
    expect(menuOpen(IDLE_PANE)).toBe(false);
  });
});

describe('wakeSeats', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-wake-'));
    mkdirSync(path.join(dataDir, 'spawn'));
    const config = { mcpServers: { [SERVER_NAME]: { headers: { [SEAT_HEADER]: 'seat-b106' } } } };
    writeFileSync(path.join(dataDir, 'spawn', 'B106-mcp.json'), JSON.stringify(config));
  });

  afterEach(() => {
    rmSync(dataDir, { force: true, recursive: true });
  });

  const run = ({ pane }: { pane: string }) => {
    const calls: string[][] = [];
    const tmux = (args: string[]) => {
      calls.push(args);
      const config = path.join(dataDir, 'spawn', 'B106-mcp.json');
      if (args[0] === 'list-panes') return Promise.resolve(result(`messhall-B106\tclaude --mcp-config '${config}'`));
      return Promise.resolve(result(args[0] === 'capture-pane' ? pane : ''));
    };
    const queued: unknown[] = [];
    const codex = {
      request: (_method: string, params: unknown) => {
        queued.push(params);
        return Promise.resolve({ ok: true, result: {} } as never);
      },
    };
    const seats = [seat('f10-wake', 'claude', 'seat-b106'), seat('web', 'codex', 'thread-1')];
    return { calls, codex, queued, seats, tmux };
  };

  it('types the wake line into the claude pane and queues it on the codex thread', async () => {
    const { calls, codex, queued, seats, tmux } = run({ pane: IDLE_PANE });

    const woken = await wakeSeats({ codex, dataDir, seats, settleMs: 0, tmux });

    expect(woken).toStrictEqual([
      { channel: 'tmux', names: ['f10-wake'], outcome: 'sent', target: 'messhall-B106' },
      { channel: 'codex', names: ['web'], outcome: 'sent', target: 'thread-1' },
    ]);
    expect(calls).toContainEqual(['send-keys', '-t', '=messhall-B106:', '-l', wakeText(['dev'])]);
    expect(queued).toStrictEqual([
      {
        clientUserMessageId: expect.any(String),
        input: [{ text: wakeText(['dev']), text_elements: [], type: 'text' }],
        threadId: 'thread-1',
      },
    ]);
  });

  it('never types into a pane that shows a menu, since a key there would pick an option', async () => {
    const { calls, codex, seats, tmux } = run({ pane: MENU_PANE });

    const woken = await wakeSeats({ codex, dataDir, seats: seats.slice(0, 1), settleMs: 0, tmux });

    expect(woken).toStrictEqual([{ channel: 'tmux', names: ['f10-wake'], outcome: 'menu', target: 'messhall-B106' }]);
    expect(calls.filter(args => args[0] === 'send-keys')).toStrictEqual([]);
  });
});
