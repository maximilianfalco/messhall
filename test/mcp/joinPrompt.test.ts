import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOIN_PROMPT } from '../../src/mcp/prompts.js';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

async function promptText(args: Record<string, string>) {
  const { client } = await harness.agent();
  const { messages } = await client.getPrompt({ arguments: args, name: JOIN_PROMPT.name });
  return messages.map(message => (message.content.type === 'text' ? message.content.text : '')).join('\n');
}

describe('join prompt', () => {
  it('is listed with a required room and an optional as', async () => {
    const { client } = await harness.agent();

    const { prompts } = await client.listPrompts();

    expect(prompts).toStrictEqual([
      expect.objectContaining({
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: 'room', required: true }),
          expect.objectContaining({ name: 'as', required: false }),
        ]),
        name: 'join',
      }),
    ]);
  });

  it('tells the agent to join the named room and leave the name to the folder when none is given', async () => {
    const text = await promptText({ room: 'dev' });

    expect(text).toContain('join with room "dev" and no as');
  });

  it('tells the agent to join with the given name', async () => {
    const text = await promptText({ as: 'api', room: 'dev' });

    expect(text).toContain('join with room "dev" and as "api"');
  });

  it('refuses a room name the join tool would refuse', async () => {
    const { client } = await harness.agent();

    await expect(client.getPrompt({ arguments: { room: 'Dev Room' }, name: JOIN_PROMPT.name })).rejects.toThrow();
  });

  it('says a chat with an off doorbell cannot be rung and to start it with messhall claude', async () => {
    const text = await promptText({ room: 'dev' });

    expect(text).toContain('cannot be rung');
    expect(text).toContain('messhall claude');
  });
});
