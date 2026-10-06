/** Thrown when a claude call runs past its timeout. The child is killed first. */
export class ClaudeTimeoutError extends Error {
  override readonly name = 'ClaudeTimeoutError';

  constructor({ command, timeoutMs }: { command: string; timeoutMs: number }) {
    super(`Claude Code took longer than ${timeoutMs}ms and was stopped.\ncommand: ${command}`);
  }
}
