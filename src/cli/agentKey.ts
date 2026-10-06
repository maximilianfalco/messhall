import { readFileSync } from 'node:fs';
import path from 'node:path';

import { KEY_FILES, loadKeys } from '../daemon/keys.js';

/** Reads `<dataDir>/agent-key`. Missing key files get made the same way the daemon makes them. */
export function readAgentKey(dataDir: string) {
  loadKeys({ dataDir });
  return readFileSync(path.join(dataDir, KEY_FILES.agent), 'utf8').trim();
}
