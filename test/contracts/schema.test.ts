import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CONTRACTS, contractSchema, SCHEMA_PATH } from '../../tools/dev/commands/schema.js';

describe('contracts/schema.json', () => {
  it('matches the zod contracts, run pnpm schema when this fails', () => {
    expect(readFileSync(SCHEMA_PATH, 'utf8')).toBe(contractSchema());
  });

  it('has one definition per contract with refs between them', () => {
    const schema = JSON.parse(contractSchema()) as { $defs: Record<string, { $id?: string }> };

    expect(Object.keys(schema.$defs).toSorted()).toStrictEqual(Object.keys(CONTRACTS).toSorted());
    expect(Object.values(schema.$defs).filter(definition => definition.$id)).toStrictEqual([]);
    expect(contractSchema()).toContain('"$ref": "#/$defs/Message"');
  });
});
