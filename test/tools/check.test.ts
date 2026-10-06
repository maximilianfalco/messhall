import { describe, expect, it } from 'vitest';

import { runCheck } from '../../tools/dev/commands/check.js';

const step = (name: string, code: number, stdout = '') => ({
  name,
  run: () => Promise.resolve({ code, ms: 5, stderr: '', stdout }),
});

describe('runCheck', () => {
  it('exits 0 when every step passes', async () => {
    const result = await runCheck({ steps: [step('format', 0), step('lint', 0)] });

    expect(result.code).toBe(0);
    expect(result.report).toContain('all checks passed');
  });

  it('exits 1 and names the failing step with its output', async () => {
    const result = await runCheck({ steps: [step('format', 0), step('lint', 1, 'no-unused-vars in src/cli.ts')] });

    expect(result.code).toBe(1);
    expect(result.failed).toStrictEqual(['lint']);
    expect(result.report).toContain('no-unused-vars in src/cli.ts');
    expect(result.report).toContain('check failed');
  });

  it('runs the steps at the same time', async () => {
    const started: string[] = [];
    let release = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const slow = (name: string) => ({
      name,
      run: async () => {
        started.push(name);
        if (started.length === 2) release();
        await gate;
        return { code: 0, ms: 1, stderr: '', stdout: '' };
      },
    });

    const result = await runCheck({ steps: [slow('format'), slow('lint')] });

    expect(result.code).toBe(0);
    expect(started).toStrictEqual(['format', 'lint']);
  });
});
