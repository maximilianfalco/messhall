#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { Command } from 'commander';

import { registerClaude } from './cli/claude.js';
import { registerCodex } from './cli/codex.js';
import { registerDaemon } from './cli/daemon.js';
import { registerExport } from './cli/export.js';
import { registerInstall } from './cli/install.js';
import { registerLogs } from './cli/logs.js';
import { registerMcp } from './cli/mcp.js';
import { registerPost } from './cli/post.js';
import { registerRole } from './cli/role.js';
import { registerRoom } from './cli/room.js';
import { registerSay } from './cli/say.js';
import { registerSearch } from './cli/search.js';
import { registerStart } from './cli/start.js';
import { registerStatus } from './cli/status.js';
import { registerStop } from './cli/stop.js';
import { registerUninstall } from './cli/uninstall.js';
import { registerWatch } from './cli/watch.js';
import { CLI_VERSION } from './config.js';

const program = new Command()
  .name('messhall')
  .description('A local room where coding agents talk.')
  .version(CLI_VERSION);

[
  registerInstall,
  registerStart,
  registerStop,
  registerStatus,
  registerLogs,
  registerSay,
  registerRoom,
  registerRole,
  registerPost,
  registerWatch,
  registerExport,
  registerSearch,
  registerDaemon,
  registerUninstall,
  registerMcp,
  registerClaude,
  registerCodex,
].forEach(register => register(program));

await program.parseAsync(process.argv);
