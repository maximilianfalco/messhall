import { describe, expect, it } from 'vitest';

import { runCommandWithin } from '../../src/lib/run.js';

describe('runCommandWithin', () => {
  it('stops a command that runs past the timeout and reads it as a failure', async () => {
    const started = Date.now();

    const result = await runCommandWithin(100)('sleep', ['5']);

    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('gives the output of a command that ends in time', async () => {
    await expect(runCommandWithin(2000)('echo', ['hi'])).resolves.toStrictEqual({
      code: 0,
      stderr: '',
      stdout: 'hi\n',
    });
  });
});
