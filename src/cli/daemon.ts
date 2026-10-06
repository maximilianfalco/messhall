import type { Command } from 'commander';

import { daemonPort, dataDir } from '../config.js';
import { startDaemon } from '../daemon/server.js';
import { PortTakenError } from '../errors/PortTakenError.js';
import { logger } from '../lib/logger.js';

/** Starts the daemon. A taken port is logged with the pid that holds it and gives code 1. */
export async function runDaemon({
  dataDir: dir,
  findPortHolder,
  now = () => new Date(),
  port,
}: {
  dataDir: string;
  findPortHolder?: (port: number) => Promise<string | undefined>;
  now?: () => Date;
  port: number;
}) {
  const started = await startDaemon({ dataDir: dir, findPortHolder, now, port });
  if (!started.ok) {
    const error = new PortTakenError({ pid: started.pid, port: started.port });
    logger.error(error, { message: error.message, pid: started.pid, port: started.port });
    return { code: 1 } as const;
  }
  return { code: 0, daemon: started.daemon } as const;
}

/** Registers `daemon`, the server in the foreground. launchd runs this same command. */
export function registerDaemon(program: Command) {
  program
    .command('daemon')
    .description('Run the daemon in the foreground. Honors MESSHALL_HOME and MESSHALL_PORT.')
    .action(async () => {
      const result = await runDaemon({ dataDir: dataDir(), port: daemonPort() });
      if (result.code !== 0) {
        process.exitCode = result.code;
        return;
      }
      const stop = async () => {
        await result.daemon.close();
        logger.info('daemon stopped');
        process.exit(0);
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    });
}
