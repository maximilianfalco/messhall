/** Logged when another process holds the daemon port. The daemon exits instead of moving. */
export class PortTakenError extends Error {
  override readonly name = 'PortTakenError';

  constructor({ pid, port }: { pid: string | undefined; port: number }) {
    super(`port ${port} is taken by ${pid ? `pid ${pid}` : 'another process'}. stop it or set MESSHALL_PORT`);
  }
}
