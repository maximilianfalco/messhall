/** Thrown when claude exits 0 but its stdout is not the json result envelope. */
export class ClaudeOutputError extends Error {
  override readonly name = 'ClaudeOutputError';

  constructor({ issue, raw }: { issue: string; raw: string }) {
    super(`Claude Code answered in an unknown shape.\n${issue}\nraw answer:\n${raw}`);
  }
}
