import { describe, expect, it } from 'vitest';

import { codexTuis } from '../../src/codex/tuis.js';

describe('codexTuis', () => {
  it('keeps codex tuis and drops the daemon, helpers and other subcommands', () => {
    const ps = [
      '  PID ARGS',
      '  101 codex',
      '  102 /opt/homebrew/bin/codex resume 019a',
      '  103 codex app-server',
      '  104 /Users/someone/.codex/packages/app-server-daemon/current/bin/codex app-server --listen unix://',
      '  105 /opt/homebrew/Caskroom/codex/0.157.1/bin/codex-code-mode-host',
      '  106 node /tmp/plugins/codex/scripts/app-server-broker.mjs serve',
      '  107 codex exec hello',
      '  108 codex -c model=o3',
    ].join('\n');

    expect(codexTuis(ps)).toStrictEqual([
      { flag: null, pid: 101 },
      { flag: null, pid: 102 },
      { flag: '-c', pid: 108 },
    ]);
  });

  it.each([
    ['codex -c model=o3', '-c'],
    ['codex --config model=o3', '--config'],
    ['codex --enable web_search', '--enable'],
    ['codex --disable apps', '--disable'],
    ['codex --search', '--search'],
    ['codex --no-daemon', '--no-daemon'],
  ])('flags %s as embedded by %s', (args, flag) => {
    expect(codexTuis(`PID ARGS\n  7 ${args}`)).toStrictEqual([{ flag, pid: 7 }]);
  });
});
