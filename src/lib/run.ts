import { execFile } from 'node:child_process';

export interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

export type Runner = (command: string, args: string[]) => Promise<RunResult>;

/** Runs a command to the end and captures its output, killing it after `timeout` ms when that is above 0.
 * Never throws on a non-zero exit, a kill or a missing binary. */
export const runCommandWithin =
  (timeout: number): Runner =>
  (command, args) =>
    new Promise(resolve => {
      execFile(command, args, { timeout }, (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stderr: String(stderr), stdout: String(stdout) });
      });
    });

/** Runs a command to the end and captures its output. Never throws on a non-zero exit or a missing binary. */
export const runCommand: Runner = runCommandWithin(0);
