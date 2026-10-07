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
  MENU_LAYERS,
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

  it('picks a window floated for a recording but never the menu bar label', () => {
    expect(pickWindow(['10 25 48 24', '12 3 980 640'].join('\n'))).toBe(12);
  });

  it('picks the open menu bar menu when asked for the menu layer', () => {
    expect(pickWindow(['10 25 48 24', '11 101 207 128', '12 0 980 640'].join('\n'), MENU_LAYERS)).toBe(11);
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
      ['handoff', true, 'api', false],
      ['history', true, 'planner', false],
      ['kickoff', true, 'human', true],
      ['release-notes', true, 'human', true],
    ]);
    expect(
      members.map(member => `${member.name} ${member.kind} ${member.presence} ${member.client_label}`),
    ).toStrictEqual([
      'api claude active claude',
      'human human idle null',
      'qa other idle opencode',
      'web codex waiting codex',
    ]);
    expect(page.ok && page.messages.map(message => message.kind)).toContain('done');
    expect(
      page.ok && page.messages.filter(message => message.from === 'ci').map(message => message.from_client_label),
    ).toStrictEqual(['script']);
    expect(docs.ok && docs.messages.length).toBeGreaterThan(20);
    expect(docs.ok && docs.messages.findIndex(message => message.from === 'human')).toBe(7);
  });

  it('leaves a human-made room with no agents and no posts', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const store = createRoomStore({ db, now: () => now });
    const members = store.listMembers('kickoff').map(member => member.name);
    const page = store.listMessages({ limit: 50, room: 'kickoff' });
    db.close();

    expect(members).toStrictEqual(['human']);
    expect(page.ok && page.messages).toStrictEqual([]);
  });

  it('leaves runs of joins and leaves between posts in the handoff room, with a human line between two runs', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const page = createRoomStore({ db, now: () => now }).listMessages({ limit: 50, room: 'handoff' });
    db.close();

    expect(page.ok && page.messages.map(message => message.kind).join(' ')).toBe(
      'system system system system system chat chat system system chat system system chat system system system system',
    );
  });

  it('leaves away agents beside a live one in the handoff room, for the away chip', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const members = createRoomStore({ db, now: () => now }).listMembers('handoff');
    db.close();

    expect(members.map(member => `${member.name} ${member.presence}`)).toStrictEqual([
      'api idle',
      'design away',
      'docs away',
      'human active',
    ]);
  });

  it('keeps every left and away agent through the first 3 minutes of a shot run', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const later = new Date(now.getTime() + 3 * 60_000);
    const dropped = createRoomStore({ db, now: () => later }).clearStale();
    db.close();

    expect(dropped).toStrictEqual([]);
  });

  it('leaves a room with 120 posts, more than the snapshot holds, so its top pages in', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'messhall-shot-'));
    const now = new Date('2026-01-01T12:00:00.000Z');

    seedShotRooms({ dataDir, now });

    const db = openDb({ dataDir });
    const store = createRoomStore({ db, now: () => now });
    const history = store.listRooms().find(room => room.name === 'history');
    const page = store.listMessages({ limit: 200, room: 'history' });
    db.close();

    expect(history?.message_count).toBe(120);
    expect(page.ok && page.messages[1]?.text).toBe('step 1 of 120: read the plan');
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
      '-appSettings',
      '"{}"',
    ]);
  });

  it('hands every shot its own settings so the real app settings never leak in', () => {
    const args = shotArgs({ appearance: 'light', muted: true, name: 'muted-light' });

    expect(JSON.parse(JSON.parse(args[args.indexOf('-appSettings') + 1] ?? ''))).toStrictEqual({
      mutedRooms: ['checkout'],
    });
  });

  it('opens Settings on the pane named by the shot', () => {
    const args = shotArgs({ appearance: 'dark', name: 'settings-avatars-dark', settings: 'avatars' });

    expect(args[args.indexOf('-shotSettings') + 1]).toMatch(/demo\/out\/shots\/settings-avatars-dark\.window$/);
    expect(JSON.parse(JSON.parse(args[args.indexOf('-appSettings') + 1] ?? ''))).toMatchObject({ pane: 'avatars' });
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

  it('scrolls the long room to the top so an older page loads, and has the app note where the anchor row landed', () => {
    const args = shotArgs({ appearance: 'dark', name: 'history-dark', pageTop: true, room: 'history' });

    expect(args).toStrictEqual(expect.arrayContaining(['-shotRoom', 'history']));
    expect(args[args.indexOf('-shotPageTop') + 1]).toMatch(/demo\/out\/shots\/history-dark\.anchor$/);
  });

  it('presses keys in the composer and has the app note the field after each one', () => {
    const args = shotArgs({ appearance: 'light', keys: '@a|return', name: 'mention-pick-light', room: 'checkout' });

    expect(args).toStrictEqual(expect.arrayContaining(['-shotKeys', '@a|return']));
    expect(args[args.indexOf('-shotKeysOut') + 1]).toMatch(/demo\/out\/shots\/mention-pick-light\.keys$/);
  });

  it('sets a role through the app for the role shot', () => {
    expect(shotArgs({ appearance: 'light', name: 'role-light', role: 'qa=reviewer', room: 'checkout' })).toStrictEqual(
      expect.arrayContaining(['-shotRole', 'qa=reviewer', '-shotRoom', 'checkout']),
    );
  });

  it('removes a member through the app for the removed shot', () => {
    expect(
      shotArgs({ appearance: 'light', name: 'removed-light', openFolds: true, remove: 'docs', room: 'handoff' }),
    ).toStrictEqual(expect.arrayContaining(['-shotRemove', 'docs', '-shotRoom', 'handoff']));
  });

  it('tells the app which block macOS puts on its banners for the blocked shots', () => {
    expect(shotArgs({ appearance: 'light', name: 'notify-blocked-light', notify: 'denied' })).toStrictEqual(
      expect.arrayContaining(['-shotNotify', 'denied']),
    );
  });

  it('builds the app as if for an older contract for the older-app shot', () => {
    expect(shotArgs({ appearance: 'light', contract: 0, name: 'older-light', room: 'checkout' })).toStrictEqual(
      expect.arrayContaining(['-shotContract', '0', '-shotRoom', 'checkout']),
    );
  });

  it('mutes a member through the app for the mute shot', () => {
    expect(
      shotArgs({ appearance: 'light', mute: 'qa', name: 'mute-light', openFolds: true, room: 'checkout' }),
    ).toStrictEqual(expect.arrayContaining(['-shotMute', 'qa', '-shotRoom', 'checkout']));
  });

  it('opens every fold for the expanded shot', () => {
    expect(shotArgs({ appearance: 'light', name: 'expanded-light', openFolds: true, room: 'handoff' })).toStrictEqual(
      expect.arrayContaining(['-shotOpenFolds', 'YES', '-shotRoom', 'handoff']),
    );
  });

  it('types the draft into the composer so the mention picker shows', () => {
    expect(shotArgs({ appearance: 'light', draft: 'thanks @', name: 'picker-light', room: 'checkout' })).toStrictEqual(
      expect.arrayContaining(['-shotDraft', 'thanks @', '-shotRoom', 'checkout']),
    );
  });

  it('opens the menu bar menu for the menu shot', () => {
    expect(shotArgs({ appearance: 'light', menuOpen: true, name: 'menu-open-light' })).toStrictEqual(
      expect.arrayContaining(['-shotMenu', 'YES']),
    );
  });

  it('presses a hotkey the real app never holds and has the app log the steps', () => {
    const args = shotArgs({ appearance: 'light', hotkey: true, name: 'hotkey-light' });

    expect(args[args.indexOf('-shotHotkey') + 1]).toMatch(/demo\/out\/shots\/hotkey-light\.hotkey$/);
    expect(JSON.parse(JSON.parse(args[args.indexOf('-appSettings') + 1] ?? ''))).toStrictEqual({
      hotkey: { key: '9', modifiers: 'controlOptionCommand' },
    });
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
