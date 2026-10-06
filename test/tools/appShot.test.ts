import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';
import {
  checkShotHome,
  isAccessory,
  leftoverApps,
  pickWindow,
  seedShotRooms,
  shotArgs,
  strayApps,
} from '../../tools/dev/commands/appShot.js';

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
  it('leaves an open room with agents and a done line, a quiet open room, a closed room and a standing room', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const store = createRoomStore({ db, now: () => now });
    const rooms = store.listRooms().map(room => [room.name, room.closed_at === null, room.created_by, room.standing]);
    const members = store.listMembers('checkout');
    const page = store.listMessages({ limit: 50, room: 'checkout' });
    const docs = store.listMessages({ limit: 50, room: 'docs-sync' });
    db.close();

    expect(rooms).toStrictEqual([
      ['billing', false, 'ledger', false],
      ['checkout', true, 'qa', false],
      ['docs-sync', true, 'writer', false],
      ['release-notes', true, 'human', true],
    ]);
    expect(members.map(member => `${member.name} ${member.kind} ${member.presence}`)).toStrictEqual([
      'api claude active',
      'human human idle',
      'qa other idle',
      'web codex waiting',
    ]);
    expect(page.ok && page.messages.map(message => message.kind)).toContain('done');
    expect(docs.ok && docs.messages.length).toBeGreaterThan(20);
  });
});

describe('leftoverApps', () => {
  it('kills only the launched pids that are still alive and returns them', () => {
    const alive = new Set([12, 30]);
    const killed: number[] = [];

    const left = leftoverApps({
      isAlive: pid => alive.has(pid),
      kill: pid => killed.push(pid),
      launched: [11, 12, 13],
    });

    expect(left).toStrictEqual([12]);
    expect(killed).toStrictEqual([12]);
  });

  it('returns nothing when every launched app quit', () => {
    expect(leftoverApps({ isAlive: () => false, kill: () => {}, launched: [11, 12] })).toStrictEqual([]);
  });
});

describe('shotArgs', () => {
  it('skips window restore so a window closed in the real app still opens', () => {
    expect(shotArgs({ appearance: 'dark', name: 'window-dark' })).toStrictEqual([
      '-ApplePersistenceIgnoreState',
      'YES',
      '-shotAppearance',
      'dark',
    ]);
  });

  it('opens the transcript at the top so a post shows the jump pill', () => {
    expect(
      shotArgs({ agentPost: true, appearance: 'light', name: 'pill-light', room: 'docs-sync', scrollTop: true }),
    ).toStrictEqual(expect.arrayContaining(['-shotScrollTop', 'YES', '-shotRoom', 'docs-sync']));
  });

  it('posts as the human and then hides and shows the sidebar for the recording', () => {
    expect(shotArgs({ appearance: 'light', name: 'sidebar-toggle', post: true, toggleSidebar: true })).toStrictEqual(
      expect.arrayContaining(['-shotPost', '-shotToggleSidebar', '2.5']),
    );
  });

  it('passes the room to open and the New Room draft', () => {
    expect(shotArgs({ appearance: 'light', name: 'closed-light', room: 'billing' }).slice(-2)).toStrictEqual([
      '-shotRoom',
      'billing',
    ]);
    expect(shotArgs({ appearance: 'light', name: 'new-room-light', newRoom: 'Release Notes' })).toStrictEqual(
      expect.arrayContaining(['-shotNewRoom', 'Release Notes', '-shotSheet']),
    );
  });

  it('has the app draw the sheet into the shot file itself', () => {
    const args = shotArgs({ appearance: 'light', name: 'new-room-light', newRoom: 'Release Notes' });

    expect(args[args.indexOf('-shotSheet') + 1]).toMatch(/demo\/out\/shots\/new-room-light\.png$/);
  });
});

describe('strayApps', () => {
  it('names app pids that showed up during the run and leaves ones running before it alone', () => {
    expect(strayApps({ after: [61116, 700, 701], before: [61116] })).toStrictEqual([700, 701]);
  });

  it('gives none when every app from the run quit', () => {
    expect(strayApps({ after: [61116], before: [61116] })).toStrictEqual([]);
  });
});

describe('isAccessory', () => {
  it('accepts an accessory app and refuses a Dock app', () => {
    expect(isAccessory('"ApplicationType"="UIElement"')).toBe(true);
    expect(isAccessory('"ApplicationType"="Foreground"')).toBe(false);
  });
});
