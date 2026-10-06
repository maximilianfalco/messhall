import { stripVTControlCharacters } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { roomReport } from '../../tools/dev/commands/room.js';
import { scratchStore } from '../rooms/scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
});

afterEach(() => {
  scratch.cleanup();
});

describe('roomReport', () => {
  it('shows members with presence and cursor, then the last messages', () => {
    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    scratch.store.joinRoom({ as: 'web', kind: 'codex', room: 'demo' });
    scratch.store.postMessage({ from: 'api', room: 'demo', text: '@web schema changed' });
    scratch.store.readUnseen({ as: 'web', room: 'demo' });

    const result = roomReport({ dataDir: scratch.dataDir, name: 'demo' });

    const text = stripVTControlCharacters(result.report);
    expect(result.code).toBe(0);
    expect(text).toContain('#demo open, 1/200 posts, made by api, not standing');
    expect(text).toMatch(/web\s+codex\s+active\s+3/);
    expect(text).toMatch(/3\s+api\s+chat\s+@web schema changed/);
  });

  it('shows the client each member sent, with its version', () => {
    scratch.store.joinRoom({
      as: 'web',
      client: { name: 'opencode', version: '1.18.34' },
      kind: 'other',
      room: 'demo',
    });

    const text = stripVTControlCharacters(roomReport({ dataDir: scratch.dataDir, name: 'demo' }).report);

    expect(text).toMatch(/web\s+other\s+opencode 1\.18\.34\s+active/);
  });

  it('says who made a standing room', () => {
    scratch.store.createRoom({ created_by: 'human', name: 'planning' });

    const text = stripVTControlCharacters(roomReport({ dataDir: scratch.dataDir, name: 'planning' }).report);

    expect(text).toContain('#planning open, 0/200 posts, made by human, standing');
  });

  it('keeps only the last messages when asked for fewer', () => {
    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    ['one', 'two', 'three'].forEach(text => scratch.store.postMessage({ from: 'api', room: 'demo', text }));

    const text = stripVTControlCharacters(roomReport({ dataDir: scratch.dataDir, limit: 2, name: 'demo' }).report);

    expect(text).not.toContain('one');
    expect(text).toMatch(/two[\s\S]*three/);
  });

  it('exits 1 for a room that does not exist', () => {
    scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    const result = roomReport({ dataDir: scratch.dataDir, name: 'nope' });

    expect(result.code).toBe(1);
    expect(stripVTControlCharacters(result.report)).toContain('no room #nope');
  });
});
