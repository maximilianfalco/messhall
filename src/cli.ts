#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { Command } from 'commander';

import { registerClaude } from './cli/claude.js';
import { registerCodex } from './cli/codex.js';
import { registerDaemon } from './cli/daemon.js';
import { registerInstall } from './cli/install.js';
import { registerLogs } from './cli/logs.js';
import { registerMcp } from './cli/mcp.js';
import { registerSay } from './cli/say.js';
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
  registerWatch,
  registerDaemon,
  registerUninstall,
  registerMcp,
  registerClaude,
  registerCodex,
].forEach(register => register(program));

await program.parseAsync(process.argv);
