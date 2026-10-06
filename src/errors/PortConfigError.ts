/** Thrown when `MESSHALL_PORT` is not a port number, so the daemon never binds a surprise port. */
export class PortConfigError extends Error {
  override readonly name = 'PortConfigError';

  constructor({ raw }: { raw: string }) {
    super(`MESSHALL_PORT must be a whole number from 0 to 65535, got ${JSON.stringify(raw)}`);
  }
}
