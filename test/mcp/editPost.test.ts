import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MINUTE = 60_000;

describe('edit_post', () => {
  it('changes the last post and says so', async () => {
    const api = await harness.joined('demo', 'api');
    await api.call('post', { room: 'demo', text: 'ship it' });

    const result = await api.call('edit_post', { room: 'demo', text: 'hold off' });

    expect(result).toMatchObject({ isError: false, text: expect.stringContaining('edited #') });
  });

  it('reads as edited to a reader who has not read it yet', async () => {
    const api = await harness.joined('demo', 'api');
    const web = await harness.joined('demo', 'web');
    await api.call('post', { room: 'demo', text: 'ship it @web' });
    await api.call('edit_post', { room: 'demo', text: 'hold off @web' });

    const read = await web.call('read_since', { room: 'demo' });

    expect(read.text).toContain('(edited)] hold off @web');
    expect(read.text).not.toContain('ship it');
  });

  it('refuses after five minutes and says why', async () => {
    const api = await harness.joined('demo', 'api');
    await api.call('post', { room: 'demo', text: 'ship it' });
    harness.clock.advance(5 * MINUTE + 1);

    const result = await api.call('edit_post', { room: 'demo', text: 'hold off' });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('5 minutes') });
  });

  it('refuses when you have not posted yet', async () => {
    const api = await harness.joined('demo', 'api');

    const result = await api.call('edit_post', { room: 'demo', text: 'hold off' });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('no post of yours') });
  });

  it('refuses a room you have not joined', async () => {
    const api = await harness.agent();

    const result = await api.call('edit_post', { room: 'demo', text: 'hold off' });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('not in #demo') });
  });
});

describe('remove_post', () => {
  it('takes the last post back and a reader sees that it was', async () => {
    const api = await harness.joined('demo', 'api');
    const web = await harness.joined('demo', 'web');
    await api.call('post', { room: 'demo', text: 'ship it @web' });

    const result = await api.call('remove_post', { room: 'demo' });
    const read = await web.call('read_since', { room: 'demo' });

    expect(result).toMatchObject({ isError: false, text: expect.stringContaining('took back #') });
    expect(read.text).toContain('(taken back)]');
    expect(read.text).not.toContain('ship it');
  });

  it('refuses after five minutes', async () => {
    const api = await harness.joined('demo', 'api');
    await api.call('post', { room: 'demo', text: 'ship it' });
    harness.clock.advance(5 * MINUTE + 1);

    const result = await api.call('remove_post', { room: 'demo' });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('5 minutes') });
  });
});
