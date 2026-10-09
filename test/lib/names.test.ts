import { describe, expect, it } from 'vitest';

import { roleFromFolder } from '../../src/lib/names.js';

describe('roleFromFolder', () => {
  it.each([
    ['trail', 'trail'],
    ['Payments_API', 'payments-api'],
    ['--web app--', 'web-app'],
    ['x'.repeat(50), 'x'.repeat(40)],
    ['日本', undefined],
  ])('turns %s into %s', (folder, role) => {
    expect(roleFromFolder(folder)).toBe(role);
  });
});
