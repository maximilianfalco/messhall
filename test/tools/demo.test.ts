import type { launchClaude } from '../../tools/dev/lib/claudeTmux.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { KEY_HEADER } from '../../src/daemon/keys.js';
import { scratchPort } from '../../tools/dev/commands/daemon.js';
import { demoRun } from '../../tools/dev/commands/demo.js';
import { claudeArgv, mcpConfigJson, shellLine } from '../../tools/dev/lib/claudeTmux.js';
import { demoChecks, repoTest, tokenUsage, writeDemoRepo } from '../../tools/dev/lib/demoCheck.js';

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'messhall-demo-test-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  dirs.splice(0).forEach(dir => rmSync(dir, { force: true, recursive: true }));
});

const API_FIX = `export interface Item {
  price: number;
  qty: number;
}

export function orderTotal(items: Item[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.price * item.qty, 0) * 100);
}
`;

const WEB_FIX = `export function formatTotal(total: number): string {
  return \`$\${(total / 100).toFixed(2)}\`;
}
`;

const room = { cap: 200, closed: true };
const members = [
  { cursor: 6, name: 'api' },
  { cursor: 6, name: 'web' },
];
const messages = [
  { from: 'api', id: 1, kind: 'chat', text: '@web the order total is now cents' },
  { from: 'web', id: 2, kind: 'chat', text: '@api ok, formatting cents now' },
  { from: 'api', id: 3, kind: 'done', text: 'api passes' },
  { from: 'web', id: 4, kind: 'done', text: 'web passes' },
  { from: 'system', id: 5, kind: 'system', text: 'all done, room closed' },
];
const failing = (transcript: Parameters<typeof demoChecks>[0]) =>
  demoChecks(transcript)
    .filter(check => !check.pass)
    .map(check => check.name);

describe('demo repos', () => {
  it.each([
    ['api', 'total.ts', API_FIX],
    ['web', 'format.ts', WEB_FIX],
  ] as const)('the %s test fails before and passes after the reference fix', async (role, file, fix) => {
    const dir = scratch();
    await writeDemoRepo({ dir, role });
    expect((await repoTest(dir)).code).toBe(1);
    writeFileSync(path.join(dir, file), fix);
    expect((await repoTest(dir)).code).toBe(0);
  });
});

describe('demoChecks', () => {
  it('passes a room where both read each other, said done and closed under the cap', () => {
    expect(failing({ members, messages, roles: ['api', 'web'], room })).toStrictEqual([]);
  });

  it('fails when an agent never read the other', () => {
    const unread = members.map(member => (member.name === 'api' ? { ...member, cursor: 1 } : member));
    expect(failing({ members: unread, messages, roles: ['api', 'web'], room })).toStrictEqual(['each read the other']);
  });

  it('fails when an agent never said done and the room stayed open', () => {
    const open = messages.filter(message => message.id < 4);
    expect(failing({ members, messages: open, roles: ['api', 'web'], room: { ...room, closed: false } })).toStrictEqual(
      ['each said done', 'room closed with all done'],
    );
  });

  it('fails a room that hit its cap', () => {
    expect(failing({ members, messages, roles: ['api', 'web'], room: { ...room, cap: 4 } })).toStrictEqual([
      'under the cap',
    ]);
  });

  it('fails when an agent never joined', () => {
    const alone = members.filter(member => member.name === 'api');
    expect(failing({ members: alone, messages, roles: ['api', 'web'], room })).toContain('both joined');
  });
});

describe('claude launcher', () => {
  it('builds the dev channel argv on a strict mcp config', () => {
    expect(
      claudeArgv({ allowedTools: ['mcp__messhall', 'Edit'], debugFile: '/d.log', mcpConfig: '/m.json' }),
    ).toStrictEqual([
      'claude',
      '--mcp-config',
      '/m.json',
      '--strict-mcp-config',
      '--dangerously-load-development-channels',
      'server:messhall',
      '--allowedTools',
      'mcp__messhall',
      'Edit',
      '--debug-file',
      '/d.log',
    ]);
  });

  it('points the mcp config at the daemon with the key header', () => {
    expect(JSON.parse(mcpConfigJson({ key: 'k', url: 'http://127.0.0.1:7792' }))).toStrictEqual({
      mcpServers: { messhall: { headers: { [KEY_HEADER]: 'k' }, type: 'http', url: 'http://127.0.0.1:7792/mcp' } },
    });
  });

  it('quotes only the args a shell would split', () => {
    expect(shellLine(['claude', '--allowedTools', 'Bash(node --test:*)', "it's"])).toBe(
      `claude --allowedTools 'Bash(node --test:*)' 'it'\\''s'`,
    );
  });
});

describe('tokenUsage', () => {
  it('counts each model call once and sums its tokens', () => {
    const usage = { cache_creation_input_tokens: 10, cache_read_input_tokens: 20, input_tokens: 1, output_tokens: 5 };
    const jsonl = [
      JSON.stringify({ message: { id: 'a', usage }, type: 'assistant' }),
      JSON.stringify({ message: { id: 'a', usage }, type: 'assistant' }),
      JSON.stringify({ message: { id: 'b', usage }, type: 'assistant' }),
      JSON.stringify({ message: { content: 'hi' }, type: 'user' }),
      'not json',
    ].join('\n');
    expect(tokenUsage(jsonl)).toStrictEqual({ calls: 2, input: 62, output: 10 });
  });
});

describe('demoRun --dry-run', () => {
  it('sets up the daemon and both repos, prints the claude lines and starts no model', async () => {
    const launch = vi.fn<typeof launchClaude>();
    const result = await demoRun({
      dryRun: true,
      home: scratch(),
      keep: false,
      launch,
      port: await scratchPort(),
      timeoutS: 240,
    });
    expect(launch).not.toHaveBeenCalled();
    expect(result.code).toBe(0);
    expect(result.report).toContain('--dangerously-load-development-channels server:messhall');
    expect(result.report).toContain('you are the web agent');
  }, 30_000);
});
