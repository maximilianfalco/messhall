import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';
import { checkShotHome, pickWindow, seedShotRooms } from '../../tools/dev/commands/appShot.js';

describe('pickWindow', () => {
  it('picks the largest layer 0 window', () => {
    const lines = ['10 25 48 24', '11 0 300 200', '12 0 980 640', '13 0 0 0'];

    expect(pickWindow(lines.join('\n'))).toBe(12);
  });

  it('gives undefined when the app has no window yet', () => {
    expect(pickWindow('10 25 48 24\n')).toBeUndefined();
  });
});

describe('checkShotHome', () => {
  it('refuses the real data dir', () => {
    expect(checkShotHome(path.join(homedir(), 'Library', 'Application Support', 'messhall'))).toMatch(/real data dir/);
  });

  it('accepts a scratch dir', () => {
    expect(checkShotHome('/tmp/messhall-tape-home-app')).toBeUndefined();
  });
});

describe('seedShotRooms', () => {
  it('leaves an open room with agents and a done line, a quiet open room and a closed room', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const store = createRoomStore({ db, now: () => now });
    const rooms = store.listRooms().map(room => [room.name, room.closed_at === null]);
    const members = store.listMembers('checkout');
    const page = store.listMessages({ limit: 50, room: 'checkout' });
    db.close();

    expect(rooms).toStrictEqual([
      ['billing', false],
      ['checkout', true],
      ['docs-sync', true],
    ]);
    expect(members.map(member => `${member.name} ${member.kind} ${member.presence}`)).toStrictEqual([
      'api claude active',
      'human human idle',
      'qa other idle',
      'web codex waiting',
    ]);
    expect(page.ok && page.messages.map(message => message.kind)).toContain('done');
  });
});
