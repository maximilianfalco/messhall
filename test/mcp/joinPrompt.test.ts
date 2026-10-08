import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INSTRUCTIONS } from '../../src/mcp/constants.js';
import { JOIN_PROMPT, TAKE_TO_ROOM_PROMPT } from '../../src/mcp/prompts.js';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

async function promptText(args: Record<string, string>, name: string = JOIN_PROMPT.name) {
  const { client } = await harness.agent();
  const { messages } = await client.getPrompt({ arguments: args, name });
  return messages.map(message => (message.content.type === 'text' ? message.content.text : '')).join('\n');
}

describe('join prompt', () => {
  it('is listed with a required room and an optional as', async () => {
    const { client } = await harness.agent();

    const { prompts } = await client.listPrompts();

    expect(prompts).toContainEqual(
      expect.objectContaining({
        arguments: [
          expect.objectContaining({ name: 'room', required: true }),
          expect.objectContaining({ name: 'as', required: false }),
        ],
        name: 'join',
      }),
    );
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

    expect(text).toContain('doorbell: off');
    expect(text).toContain('cannot be rung');
    expect(text).toContain('messhall claude');
  });
});

describe('take to room prompt', () => {
  it('is listed with an optional room and an optional as', async () => {
    const { client } = await harness.agent();

    const { prompts } = await client.listPrompts();

    expect(prompts).toContainEqual(
      expect.objectContaining({
        arguments: [
          expect.objectContaining({ name: 'room', required: false }),
          expect.objectContaining({ name: 'as', required: false }),
        ],
        name: 'take-to-room',
      }),
    );
  });

  it('tells the agent to look at the open rooms and pick one that fits when no room is given', async () => {
    const text = await promptText({}, TAKE_TO_ROOM_PROMPT.name);

    expect(text).toContain('list_rooms');
    expect(text).toContain('a new room with a topic');
  });

  it('tells the agent to join the named room without listing rooms', async () => {
    const text = await promptText({ as: 'api', room: 'dev' }, TAKE_TO_ROOM_PROMPT.name);

    expect(text).toContain('join with room "dev" and as "api"');
    expect(text).not.toContain('list_rooms');
  });

  it('asks for a hand-over of what it was doing, where and what it needs', async () => {
    const text = await promptText({}, TAKE_TO_ROOM_PROMPT.name);

    expect(text).toMatch(/what you were doing/);
    expect(text).toMatch(/repo path and branch/);
    expect(text).toMatch(/what you need/);
  });

  it('says a chat with an off doorbell cannot be rung', async () => {
    const text = await promptText({}, TAKE_TO_ROOM_PROMPT.name);

    expect(text).toContain('doorbell: off');
    expect(text).toContain('cannot be rung');
  });

  it('refuses a room name the join tool would refuse', async () => {
    const { client } = await harness.agent();

    await expect(
      client.getPrompt({ arguments: { room: 'Dev Room' }, name: TAKE_TO_ROOM_PROMPT.name }),
    ).rejects.toThrow();
  });

  it('has the server instructions tell a running agent to take its work to a room', () => {
    expect(INSTRUCTIONS).toContain('take this to a room');
    expect(INSTRUCTIONS).toContain('list_rooms');
  });
});
