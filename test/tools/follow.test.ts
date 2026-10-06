import { describe, expect, it } from 'vitest';

import { backoffMs } from '../../tools/dev/lib/follow.js';

describe('backoffMs', () => {
  it('waits 2, 5 and 10 s, then every 15 s forever', () => {
    expect([0, 1, 2, 3, 4, 50].map(attempt => backoffMs(attempt))).toStrictEqual([
      2000, 5000, 10_000, 15_000, 15_000, 15_000,
    ]);
  });
});
