import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTRACTS } from '../../tools/dev/commands/schema.js';
import { REPO_ROOT } from '../../tools/dev/lib/paths.js';

const FIXTURES = path.join(REPO_ROOT, 'app', 'Messhall', 'Tests', 'FeedTests', 'Fixtures');
const files = readdirSync(FIXTURES).filter(file => file.endsWith('.json'));
const isContract = (name: string): name is keyof typeof CONTRACTS => name in CONTRACTS;

describe('Mac app fixtures', () => {
  it('names each fixture after a contract', () => {
    expect(files.map(file => path.basename(file, '.json')).filter(name => !isContract(name))).toStrictEqual([]);
  });

  it.each(files)('%s matches its contract with no extra fields', file => {
    const name = path.basename(file, '.json');
    if (!isContract(name)) throw new Error(`${name} is not a contract`);
    const json: unknown = JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8'));

    expect(CONTRACTS[name].parse(json)).toStrictEqual(json);
  });
});
