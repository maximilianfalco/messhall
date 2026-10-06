export interface ClaudeNotConfiguredDetails {
  command: string;
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

/** Thrown when the claude binary is missing or exits non-zero. The message keeps the command and its stderr. */
export class ClaudeNotConfiguredError extends Error {
  override readonly name = 'ClaudeNotConfiguredError';

  constructor({ command, exitCode, stderr, stdout }: ClaudeNotConfiguredDetails) {
    const output = stderr.trim() ? ['stderr:', stderr.trimEnd()] : ['stderr: (empty)', 'stdout:', stdout.trimEnd()];
    super(
      [
        'Claude Code did not answer.',
        `command: ${command}`,
        `exit code: ${exitCode ?? 'none'}`,
        ...output,
        'Fix: install Claude Code and run `claude` once to log in.',
      ].join('\n'),
    );
  }
}
