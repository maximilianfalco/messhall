import type { Handler } from './router.js';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { KeyFileError } from '../errors/KeyFileError.js';

import { sendJson } from './router.js';

export const KEY_HEADER = 'x-messhall-key';
export const KEY_FILES = { agent: 'agent-key', human: 'human-key' } as const;

export type KeyKind = keyof typeof KEY_FILES;

const KEY_BYTES = 32;
const OWNER_ONLY = 0o600;

function readOrCreate(file: string) {
  try {
    writeFileSync(file, randomBytes(KEY_BYTES).toString('hex'), { flag: 'wx', mode: OWNER_ONLY });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  if (statSync(file).mode % 0o1000 !== OWNER_ONLY) chmodSync(file, OWNER_ONLY);
  const key = readFileSync(file, 'utf8').trim();
  if (!key) throw new KeyFileError({ file });
  return key;
}

// Hashing first gives both sides the same length, which timingSafeEqual needs.
const digest = (text: string) => createHash('sha256').update(text).digest();
const same = (presented: string, expected: string) => timingSafeEqual(digest(presented), digest(expected));

/** Makes `<dataDir>/agent-key` and `<dataDir>/human-key` (0600) when missing and loads them.
 * The keys stay in this closure, so callers only ever get `requireKey`. */
export function loadKeys({ dataDir }: { dataDir: string }) {
  mkdirSync(dataDir, { recursive: true });
  const keys: Record<KeyKind, string> = {
    agent: readOrCreate(path.join(dataDir, KEY_FILES.agent)),
    human: readOrCreate(path.join(dataDir, KEY_FILES.human)),
  };
  return {
    /** Runs `handler` only when the request's key header matches the `kind` key, else answers 401. */
    requireKey(kind: KeyKind, handler: Handler) {
      return ((req, res) => {
        const presented = req.headers[KEY_HEADER];
        if (typeof presented !== 'string' || !same(presented, keys[kind])) {
          sendJson(res, 401, { error: `missing or wrong ${KEY_HEADER}` });
          return;
        }
        return handler(req, res);
      }) satisfies Handler;
    },
  };
}

export type Keys = ReturnType<typeof loadKeys>;
