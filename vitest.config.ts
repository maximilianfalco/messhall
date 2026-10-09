import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

const scratch = path.join(tmpdir(), 'messhall-vitest');
// tmux makes its socket folder inside TMUX_TMPDIR but never the folder itself.
mkdirSync(scratch, { recursive: true });

export default defineConfig({
  test: {
    // An empty TMUX makes tmux use TMUX_TMPDIR, so no test reaches the real server the agents run in.
    env: { MESSHALL_HOME: scratch, TMUX: '', TMUX_TMPDIR: scratch },
    // node:sqlite warns on every import on Node 22.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    include: ['test/**/*.test.ts'],
  },
});
