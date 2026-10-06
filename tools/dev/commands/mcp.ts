import type { McpSession } from '../../../src/mcp/session.js';
import type { Command } from 'commander';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TEXT_BUDGET, TOOL_NAMES } from '../../../src/mcp/constants.js';
import { createMesshallServer } from '../../../src/mcp/server.js';
import { createSession, createSessionRegistry } from '../../../src/mcp/session.js';
import { connectInMemory } from '../../../src/mcp/testing.js';
import { openDb } from '../../../src/rooms/db.js';
import { createRoomStore } from '../../../src/rooms/store.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';

interface McpOptions {
  as?: string;
  input?: string;
  room?: string;
  tool?: string;
}

type CallResult = Awaited<ReturnType<Awaited<ReturnType<typeof connectInMemory>>['callTool']>>;

const textOf = (result: CallResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');

const budget = (length: number) => `${length}/${TEXT_BUDGET}`;

function fieldsOf(schema: { properties?: Record<string, unknown>; required?: string[] }) {
  const required = new Set(schema.required ?? []);
  const names = Object.keys(schema.properties ?? {}).toSorted();
  return names.map(name => (required.has(name) ? name : `${name}?`)).join(', ') || '(none)';
}

function parseInput(raw: string | undefined) {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The MCP server over an in-memory client on a scratch store. With no tool, the instructions and
 * every tool. With a tool, one call after joining `room` as `as` when both are given.
 */
export async function mcpReport({ as, input, room, tool }: McpOptions) {
  if (tool && !(TOOL_NAMES as readonly string[]).includes(tool)) {
    return { code: 1, report: bad(`no tool ${tool}. tools: ${TOOL_NAMES.join(', ')}`) };
  }
  const args = parseInput(input);
  if (!args) return { code: 1, report: bad(`--input is not a JSON object: ${input}`) };

  const home = mkdtempSync(path.join(tmpdir(), 'messhall-mcp-'));
  const db = openDb({ dataDir: home });
  const now = () => new Date();
  const store = createRoomStore({ db, now });
  const session = createSession({ id: 'dev', now });
  const sessions = createSessionRegistry<{ session: McpSession }>();
  sessions.add({ session });
  const client = await connectInMemory(() => createMesshallServer({ now, session, sessions, store }));
  try {
    if (!tool) {
      const { tools } = await client.listTools();
      const instructions = client.getInstructions() ?? '';
      const toolLines = tools.flatMap(item => [
        `${item.name} (${item.annotations?.readOnlyHint ? 'read only' : 'writes'}, ${budget(item.description?.length ?? 0)} chars): ${item.title ?? ''}`,
        dim(`  ${fieldsOf(item.inputSchema)}`),
      ]);
      const report = [
        dim(instructions),
        '',
        formatTable(
          ['server', ''],
          [
            ['name', client.getServerVersion()?.name ?? ''],
            ['instructions', `${budget(instructions.length)} chars`],
            ['capabilities', JSON.stringify(client.getServerCapabilities())],
          ],
        ),
        '',
        ...toolLines,
      ];
      return { code: 0, report: report.join('\n') };
    }

    const lines: string[] = [];
    if (tool !== 'join' && as && room) {
      const joined = await client.callTool({ arguments: { as, room }, name: 'join' });
      lines.push(dim(`join as ${as} in #${room}: ${joined.isError ? 'refused' : 'ok'}`));
    }
    const defaults: Record<string, unknown> = {};
    if (room) defaults.room = room;
    if (tool === 'join' && as) defaults.as = as;
    const result = await client.callTool({ arguments: { ...defaults, ...args }, name: tool });
    lines.push(`isError: ${Boolean(result.isError)}`, textOf(result));
    return { code: result.isError ? 1 : 0, report: [...lines, '', result.isError ? bad(tool) : ok(tool)].join('\n') };
  } finally {
    await client.close();
    db.close();
    rmSync(home, { force: true, recursive: true });
  }
}

/** Registers `mcp [--tool <name> --input <json> --as <role> --room <room>]`. */
export function registerMcp(program: Command) {
  program
    .command('mcp')
    .description('The MCP server over an in-memory client: instructions and tools, or one tool call.')
    .option('--tool <name>', 'call one tool')
    .option('--input <json>', 'the tool input as a JSON object')
    .option('--as <role>', 'join as this role first')
    .option('--room <room>', 'the room to join first and to pass to the tool')
    .action(async (options: McpOptions) => {
      const result = await mcpReport(options);
      console.log(result.report);
      process.exitCode = result.code;
    });
}
