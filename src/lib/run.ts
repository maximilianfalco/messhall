import { execFile } from 'node:child_process';

export interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

export type Runner = (command: string, args: string[]) => Promise<RunResult>;

/** Runs a command to the end and captures its output. Never throws on a non-zero exit or a missing binary. */
export const runCommand: Runner = (command, args) =>
  new Promise(resolve => {
    execFile(command, args, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stderr: String(stderr), stdout: String(stdout) });
    });
  });
