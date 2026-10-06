import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { vi } from 'vitest';

import { dataDir as configDataDir } from '../../src/config.js';
import { openDb } from '../../src/rooms/db.js';
import { createRoomStore } from '../../src/rooms/store.js';

export const T0 = Date.parse('2026-01-01T10:00:00.000Z');

/** A store under a fresh temp `MESSHALL_HOME` with a clock that only moves when told. */
export function scratchStore() {
  vi.stubEnv('MESSHALL_HOME', mkdtempSync(path.join(tmpdir(), 'messhall-store-')));
  const dataDir = configDataDir();
  let at = T0;
  const clock = {
    advance: (ms: number) => {
      at += ms;
    },
    now: () => new Date(at),
  };
  let db = openDb({ dataDir });
  let store = createRoomStore({ db, now: clock.now });
  return {
    clock,
    dataDir,
    get db() {
      return db;
    },
    get store() {
      return store;
    },
    reopen() {
      db.close();
      db = openDb({ dataDir });
      store = createRoomStore({ db, now: clock.now });
    },
    cleanup() {
      db.close();
      rmSync(dataDir, { force: true, recursive: true });
      vi.unstubAllEnvs();
    },
  };
}
