import { Command } from 'commander';

import { registerCheck } from './commands/check.js';
import { registerDb } from './commands/db.js';
import { registerEnv } from './commands/env.js';
import { registerFeatureMap } from './commands/featuremap.js';
import { registerQaUpload } from './commands/qaUpload.js';
import { registerStore } from './commands/store.js';

const program = new Command()
  .name('messhall-dev')
  .description('Local dev tool. Gives an agent reproducible evidence that Messhall works, surface by surface.');

[registerCheck, registerFeatureMap, registerEnv, registerQaUpload, registerDb, registerStore].forEach(register =>
  register(program),
);

await program.parseAsync(process.argv);
