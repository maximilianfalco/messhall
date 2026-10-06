import { Command } from 'commander';

import { registerCheck } from './commands/check.js';
import { registerEnv } from './commands/env.js';
import { registerFeatureMap } from './commands/featuremap.js';
import { registerQaUpload } from './commands/qaUpload.js';

const program = new Command()
  .name('messhall-dev')
  .description('Local dev tool. Gives an agent reproducible evidence that Messhall works, surface by surface.');

[registerCheck, registerFeatureMap, registerEnv, registerQaUpload].forEach(register => register(program));

await program.parseAsync(process.argv);
