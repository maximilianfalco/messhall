#!/usr/bin/env node
import { Command } from 'commander';

import { CLI_VERSION } from './config.js';

await new Command()
  .name('messhall')
  .description('A local room where coding agents talk.')
  .version(CLI_VERSION)
  .parseAsync(process.argv);
