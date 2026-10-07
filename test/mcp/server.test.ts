import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../../src/config.js';
import { INSTRUCTIONS, TEXT_BUDGET, TOOL_DESCRIPTIONS, TOOL_NAMES, TOOL_TITLES } from '../../src/mcp/constants.js';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('createMesshallServer', () => {
  it('sends its name, version, instructions and the channel capability on initialize', async () => {
    const { client } = await harness.agent();

    expect(client.getServerVersion()).toMatchObject({ name: 'messhall', version: CLI_VERSION });
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(client.getServerCapabilities()?.experimental).toStrictEqual({
      'claude/channel': {},
      'claude/channel/permission': {},
    });
  });

  it('lists exactly the seven room tools with their titles', async () => {
    const { client } = await harness.agent();

    const { tools } = await client.listTools();

    expect(tools.map(tool => tool.name)).toStrictEqual([...TOOL_NAMES]);
    tools.forEach(tool => expect(tool.title).toBe(TOOL_TITLES[tool.name as keyof typeof TOOL_TITLES]));
  });

  it('marks only read_since, wait, my_role and the list tools read only', async () => {
    const { client } = await harness.agent();

    const { tools } = await client.listTools();

    const readOnly = tools.filter(tool => tool.annotations?.readOnlyHint).map(tool => tool.name);
    expect(readOnly).toStrictEqual(['read_since', 'wait', 'list_members', 'list_rooms', 'my_role', 'agreements']);
  });

  it('describes every input field with a sentence', async () => {
    const { client } = await harness.agent();

    const { tools } = await client.listTools();

    const fields = tools.flatMap(tool =>
      Object.entries(tool.inputSchema.properties ?? {}).map(([field, schema]) => ({
        description: (schema as { description?: string }).description ?? '',
        field: `${tool.name}.${field}`,
      })),
    );
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach(({ description }) => expect(description).toMatch(/\.$/));
  });

  it('tells agents done is for leaving the task, never a heads-up', async () => {
    const { client } = await harness.agent();
    const { tools } = await client.listTools();
    const done = tools.find(tool => tool.name === 'post')?.inputSchema.properties?.done as { description: string };
    expect(done.description).toMatch(/only when you leave the task for good, never on a heads-up/);
    expect(TOOL_DESCRIPTIONS.post).toMatch(/only when you leave the task for good, never on a heads-up/);
    expect(INSTRUCTIONS).toMatch(/done: true only when you leave the task for good, never on a heads-up/);
  });

  it('keeps the instructions under the text budget', () => {
    expect(INSTRUCTIONS.length).toBeLessThan(TEXT_BUDGET);
  });

  it.each(TOOL_NAMES)('keeps the %s description under the text budget', name => {
    expect(TOOL_DESCRIPTIONS[name].length).toBeLessThan(TEXT_BUDGET);
  });
});
