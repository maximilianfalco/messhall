import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  ms: number;
  stderr: string;
  stdout: string;
}

/** Runs a command to completion and captures its output and time. Never throws on a non-zero exit. */
export function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', error => resolve({ code: 1, ms: Date.now() - started, stderr: error.message, stdout }));
    child.on('close', code => resolve({ code: code ?? 1, ms: Date.now() - started, stderr, stdout }));
  });
}
