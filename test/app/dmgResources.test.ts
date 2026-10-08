import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');
const copied = (script: string) =>
  [...script.matchAll(/cp -R (?:Messhall|app\/Messhall)\/Resources\/(\w+) /g)].map(m => m[1]);

describe('dmg.sh', () => {
  it('copies every resource folder that bundle.sh copies', () => {
    const bundle = copied(read('app/scripts/bundle.sh'));
    const dmg = copied(read('app/scripts/dmg.sh'));
    expect(bundle).toEqual(['Templates', 'Avatars']);
    for (const folder of bundle) expect(dmg).toContain(folder);
  });
});
