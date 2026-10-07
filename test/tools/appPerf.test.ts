import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';
import {
  LOBBY_ROOM,
  PERF_ROOM,
  perfArgs,
  perfMember,
  perfRoom,
  perfRows,
  perfShotArgs,
  perfText,
  seedPerfRoom,
  seedPerfThinking,
} from '../../tools/dev/commands/appPerf.js';
import { PULL_REQUEST_ANSWERS } from '../../tools/dev/commands/appShot.js';

const now = new Date('2026-01-01T12:00:00.000Z');

function seeded(posts: number, members: number, rooms = 0) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-perf-'));
  seedPerfRoom({ dataDir, members, now, posts, rooms });
  return dataDir;
}

function read<T>(dataDir: string, use: (store: ReturnType<typeof createRoomStore>) => T) {
  const db = openDb({ dataDir });
  try {
    return use(createRoomStore({ db, now: () => now }));
  } finally {
    db.close();
  }
}

describe('perfText', () => {
  it('links a known PR every 11th line and mentions a member every 7th', () => {
    expect(perfText(11, 60)).toContain(Object.keys(PULL_REQUEST_ANSWERS)[1]);
    expect(perfText(7, 60)).toMatch(/^@agent-08 /);
    expect(perfText(1, 60)).toBe('step 2: wrote the test');
  });
});

describe('seedPerfRoom', () => {
  it('leaves a standing lobby and the big room with every member and exactly the asked posts', () => {
    const dataDir = seeded(120, 12);

    const rooms = read(dataDir, store => store.listRooms().map(room => [room.name, room.standing, room.message_count]));
    const members = read(dataDir, store => store.listMembers(PERF_ROOM).map(member => member.name));

    expect(rooms).toStrictEqual([
      [LOBBY_ROOM, true, 0],
      [PERF_ROOM, false, 120],
    ]);
    expect(members).toStrictEqual([...Array.from({ length: 12 }, (_, i) => perfMember(i + 1)), 'human']);
  });

  it('puts a human line every 50th post', () => {
    const dataDir = seeded(120, 12);

    const page = read(dataDir, store => store.listMessages({ limit: 200, room: PERF_ROOM }));
    const chat = page.ok ? page.messages.filter(message => message.kind === 'chat') : [];

    expect(chat.map(message => message.from).filter(from => from === 'human')).toHaveLength(2);
    expect(chat[49]?.from).toBe('human');
  });

  it('puts a run of leaves and joins every 250th post', () => {
    const dataDir = seeded(260, 12);

    const page = read(dataDir, store => store.listMessages({ limit: 200, room: PERF_ROOM }));
    const kinds = page.ok ? page.messages.map(message => message.kind).join(' ') : '';

    expect(kinds).toContain('system system system system system system chat');
  });
});

describe('seedPerfRoom side rooms', () => {
  it('adds small rooms with eight agents and forty posts each beside the big one', () => {
    const dataDir = seeded(10, 8, 3);

    const rooms = read(dataDir, store => store.listRooms().map(room => [room.name, room.message_count]));
    const members = read(dataDir, store => store.listMembers(perfRoom(2)).length);

    expect(rooms).toStrictEqual([
      [LOBBY_ROOM, 0],
      [PERF_ROOM, 10],
      [perfRoom(1), 40],
      [perfRoom(2), 40],
      [perfRoom(3), 40],
    ]);
    expect(members).toBe(9);
  });
});

describe('seedPerfThinking', () => {
  it('wakes the first members active with a status and the next ones waiting', () => {
    const dataDir = seeded(10, 8);

    seedPerfThinking({ dataDir, now, rooms: 0, thinking: 2, waiting: 3 });

    const members = read(dataDir, store =>
      store.listMembers(PERF_ROOM).map(member => `${member.name} ${member.presence} ${member.status ?? '-'}`),
    );
    expect(members.slice(0, 5)).toStrictEqual([
      'agent-01 active tests green on https://github.com/acme/shop/pull/42, opening the PR',
      'agent-02 active tests green on https://github.com/acme/shop/pull/43, opening the PR',
      'agent-03 waiting -',
      'agent-04 waiting -',
      'agent-05 waiting -',
    ]);
  });

  it('wakes two agents per side room and leaves the big room one open question and two agreements', () => {
    const dataDir = seeded(10, 8, 2);

    seedPerfThinking({ dataDir, now, rooms: 2, thinking: 2, waiting: 1 });

    const side = read(dataDir, store =>
      store
        .listMembers(perfRoom(2))
        .filter(member => member.status !== null)
        .map(member => member.name),
    );
    const questions = read(dataDir, store => store.openQuestions(PERF_ROOM).map(question => question.state));
    const agreements = read(dataDir, store => store.agreementsIn(PERF_ROOM).map(agreement => agreement.state));

    expect(side).toStrictEqual(['agent-01', 'agent-02']);
    expect(questions).toStrictEqual(['open']);
    expect(agreements.sort()).toStrictEqual(['open', 'settled']);
  });
});

describe('perfRows', () => {
  it('turns the report into one row per measure', () => {
    const rows = perfRows({
      dash_fps: 12.04,
      dash_worst_frame_ms: 110.4,
      event_cpu_ms: 2.46,
      event_row_bodies: 19.6,
      event_wall_ms: 400.4,
      events: 50,
      idle_cpu_percent: 1.26,
      open_ms: 120.4,
      page_all_cpu_ms: 2500.2,
      page_all_ms: 3000.6,
      pages: 50,
      pull_request_reads: 3,
      resident_mb: 300.4,
      rows: 5000,
      scroll_fps: 59.94,
      scroll_worst_frame_ms: 30.2,
      panel_fps: 57.2,
      panel_worst_frame_ms: 42.4,
      sidebar_fps: 58.4,
      sidebar_worst_frame_ms: 40.4,
    });

    expect(rows).toStrictEqual([
      ['open the room', '120 ms'],
      ['idle cpu, 10 spinners, 5 s', '1.3 %'],
      ['page in every post', '50 pages, 5000 rows, 3001 ms, cpu 2500 ms'],
      ['scroll 3,000 pt per s for 4 s', '59.9 fps, worst frame 30 ms'],
      ['dash top to bottom in 4 s', '12.0 fps, worst frame 110 ms'],
      ['sidebar hides and shows, 0.6 s each', '58.4 fps, worst frame 40 ms'],
      ['the same with the agents panel open', '57.2 fps, worst frame 42 ms'],
      ['50 incoming posts', 'cpu 2.5 ms per post, 20 row bodies per post, 400 ms wall'],
      ['pr reads during the run', '3'],
      ['resident memory at the end', '300 MB'],
    ]);
  });
});

describe('perfArgs', () => {
  it('names the report file, the room and the burst size, and opens on no room', () => {
    const args = perfArgs({ events: 50, file: '/tmp/report.json' });

    expect(args).toContain('-shotPerf');
    expect(args[args.indexOf('-shotPerf') + 1]).toBe('/tmp/report.json');
    expect(args[args.indexOf('-shotPerfRoom') + 1]).toBe(PERF_ROOM);
    expect(args[args.indexOf('-shotPerfEvents') + 1]).toBe('50');
    expect(args).not.toContain('-shotRoom');
  });

  it('a shot opens on the big room in the asked appearance', () => {
    const args = perfShotArgs('dark');

    expect(args[args.indexOf('-shotRoom') + 1]).toBe(PERF_ROOM);
    expect(args[args.indexOf('-shotAppearance') + 1]).toBe('dark');
    expect(args).not.toContain('-shotPerf');
  });
});
