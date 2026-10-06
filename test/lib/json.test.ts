import { describe, expect, it } from 'vitest';

import { StoredJsonError } from '../../src/errors/StoredJsonError.js';
import { parseStoredJson } from '../../src/lib/json.js';

describe('parseStoredJson', () => {
  it('parses stored JSON', () => {
    expect(parseStoredJson('["web"]')).toStrictEqual(['web']);
  });

  it('throws a named error on damaged JSON', () => {
    expect(() => parseStoredJson('["web"')).toThrow(StoredJsonError);
  });
});
