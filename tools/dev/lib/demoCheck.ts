import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { DB_FILE } from '../../../src/config.js';
import { SERVER_NAME } from '../../../src/mcp/constants.js';

import { run } from './run.js';

export const DEMO_ROOM = 'demo';
export const DEMO_ROLES = ['api', 'web'] as const;
export const DEMO_ALLOWED_TOOLS = [
  `mcp__${SERVER_NAME}`,
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(node --test:*)',
];

export type DemoRole = (typeof DEMO_ROLES)[number];

const tokens = z.number().default(0);
const usageLine = z.object({
  message: z.object({
    id: z.string(),
    usage: z.object({
      cache_creation_input_tokens: tokens,
      cache_read_input_tokens: tokens,
      input_tokens: tokens,
      output_tokens: tokens,
    }),
  }),
});

const PACKAGE_JSON = '{ "type": "module" }\n';

export const DEMO_REPOS: Record<DemoRole, Record<string, string>> = {
  api: {
    'package.json': PACKAGE_JSON,
    'total.test.ts': `import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orderTotal } from './total.ts';

test('the order total is in cents', () => {
  assert.equal(orderTotal([{ price: 12.5, qty: 2 }]), 2500);
});
`,
    'total.ts': `export interface Item {
  price: number;
  qty: number;
}

export function orderTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
`,
  },
  web: {
    'format.test.ts': `import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatTotal } from './format.ts';

test('formats the api order total', () => {
  assert.equal(formatTotal(2500), '$25.00');
});
`,
    'format.ts': `export function formatTotal(total: number): string {
  return \`$\${total.toFixed(2)}\`;
}
`,
    'package.json': PACKAGE_JSON,
  },
};

export interface DemoMember {
  cursor: number;
  name: string;
}

export interface DemoMessage {
  from: string;
  id: number;
  kind: string;
  text: string;
}

export interface DemoRoom {
  closed: boolean;
}

export interface DemoCheck {
  detail: string;
  name: string;
  pass: boolean;
}

/** The one paragraph each agent gets. */
export function demoPrompt(role: DemoRole) {
  const other = DEMO_ROLES.find(name => name !== role);
  return `you are the ${role} agent. join #${DEMO_ROOM} on messhall as ${role}. your test fails because the order total unit changed. agree the new contract with the ${other} agent in the room, fix your repo so \`node --test\` passes (do not edit the test), then post done: true. do not call wait: when a messhall doorbell arrives, call read_since and reply only if it concerns you. keep posts to one line.`;
}

/** Writes the role's fixture repo into `dir` and commits it, so the agent sees a clean git tree. */
export async function writeDemoRepo({ dir, role }: { dir: string; role: DemoRole }) {
  mkdirSync(dir, { recursive: true });
  Object.entries(DEMO_REPOS[role]).forEach(([file, text]) => writeFileSync(path.join(dir, file), text));
  const git = (args: string[]) =>
    run('git', ['-c', 'user.name=messhall-demo', '-c', 'user.email=demo@messhall.invalid', ...args], dir);
  await git(['init', '-q']);
  await git(['add', '.']);
  await git(['commit', '-q', '--no-verify', '-m', 'init']);
}

/** Runs the repo's tests with the same node, no install needed since node strips the types. */
export function repoTest(dir: string) {
  return run(process.execPath, ['--test'], dir);
}

/** The room, its members and messages, read only from the daemon's db. */
export function readRoom({ dataDir, name }: { dataDir: string; name: string }) {
  const file = path.join(dataDir, DB_FILE);
  if (!existsSync(file)) return;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT id, closed_at FROM rooms WHERE name = ?').get(name);
    if (!row) return;
    const room: DemoRoom = { closed: row.closed_at !== null };
    const members: DemoMember[] = db
      .prepare('SELECT name, cursor FROM members WHERE room_id = ?')
      .all(String(row.id))
      .map(member => ({ cursor: Number(member.cursor), name: String(member.name) }));
    const messages: DemoMessage[] = db
      .prepare('SELECT id, from_name, kind, text FROM messages WHERE room_id = ? ORDER BY id')
      .all(String(row.id))
      .map(message => ({
        from: String(message.from_name),
        id: Number(message.id),
        kind: String(message.kind),
        text: String(message.text),
      }));
    return { members, messages, room };
  } finally {
    db.close();
  }
}

/** The room checks: both joined, each read a post of the other, each said done, closed with all done. */
export function demoChecks({
  members,
  messages,
  roles,
  room,
}: {
  members: DemoMember[];
  messages: DemoMessage[];
  roles: readonly string[];
  room: DemoRoom;
}): DemoCheck[] {
  const posts = messages.filter(message => message.kind !== 'system');
  const missing = roles.filter(role => !members.some(member => member.name === role));
  const unread = roles.filter(role => {
    const cursor = members.find(member => member.name === role)?.cursor ?? 0;
    return roles
      .filter(other => other !== role)
      .some(other => !posts.some(message => message.from === other && message.id <= cursor));
  });
  const notDone = roles.filter(role => !posts.some(message => message.from === role && message.kind === 'done'));
  const allDone = messages.some(message => message.kind === 'system' && message.text.startsWith('all done'));
  return [
    {
      detail: missing.length ? `missing ${missing.join(', ')}` : roles.join(', '),
      name: 'both joined',
      pass: !missing.length,
    },
    {
      detail: unread.length ? `${unread.join(', ')} never read the other` : 'every cursor is past the other side',
      name: 'each read the other',
      pass: !unread.length,
    },
    {
      detail: notDone.length ? `no done from ${notDone.join(', ')}` : 'done from all',
      name: 'each said done',
      pass: !notDone.length,
    },
    {
      detail: room.closed ? (allDone ? 'all done, room closed' : 'closed without all done') : 'still open',
      name: 'room closed with all done',
      pass: room.closed && allDone,
    },
  ];
}

// A session file can hold a half written last line, so a bad line is skipped, not thrown.
const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

/** Model calls and tokens from a Claude Code session jsonl, counting each message id once. */
export function tokenUsage(jsonl: string) {
  const seen = new Map<string, { input: number; output: number }>();
  jsonl.split('\n').forEach(line => {
    const parsed = usageLine.safeParse(parseJson(line));
    if (!parsed.success) return;
    const { id, usage } = parsed.data.message;
    seen.set(id, {
      input: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
      output: usage.output_tokens,
    });
  });
  const calls = [...seen.values()];
  return {
    calls: calls.length,
    input: calls.reduce((sum, call) => sum + call.input, 0),
    output: calls.reduce((sum, call) => sum + call.output, 0),
  };
}
