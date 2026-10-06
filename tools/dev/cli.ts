import { Command } from 'commander';

import { registerAgent } from './commands/agent.js';
import { registerAppShot } from './commands/appShot.js';
import { registerChannel } from './commands/channel.js';
import { registerCheck } from './commands/check.js';
import { registerCodex } from './commands/codex.js';
import { registerCodexTypes } from './commands/codexTypes.js';
import { registerDaemon } from './commands/daemon.js';
import { registerDb } from './commands/db.js';
import { registerDemo } from './commands/demo.js';
import { registerEnv } from './commands/env.js';
import { registerFeatureMap } from './commands/featuremap.js';
import { registerFeed } from './commands/feed.js';
import { registerMcp } from './commands/mcp.js';
import { registerQaUpload } from './commands/qaUpload.js';
import { registerRoom } from './commands/room.js';
import { registerSchema } from './commands/schema.js';
import { registerSpawn } from './commands/spawn.js';
import { registerStore } from './commands/store.js';
import { registerSummarize } from './commands/summarize.js';

const program = new Command()
  .name('messhall-dev')
  .description('Local dev tool. Gives an agent reproducible evidence that Messhall works, surface by surface.');

[
  registerCheck,
  registerFeatureMap,
  registerEnv,
  registerQaUpload,
  registerDb,
  registerStore,
  registerDaemon,
  registerRoom,
  registerSummarize,
  registerSchema,
  registerFeed,
  registerMcp,
  registerAgent,
  registerAppShot,
  registerChannel,
  registerCodex,
  registerCodexTypes,
  registerDemo,
  registerSpawn,
].forEach(register => register(program));

await program.parseAsync(process.argv);
