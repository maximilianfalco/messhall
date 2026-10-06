import { Command } from 'commander';

await new Command()
  .name('messhall-dev')
  .description('Local dev tool. Gives an agent reproducible evidence that Messhall works, surface by surface.')
  .parseAsync(process.argv);
