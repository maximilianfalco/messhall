import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('post', () => {
  it('says call join first before a join', async () => {
    const agent = await harness.agent();

    const result = await agent.call('post', { room: 'checkout', text: 'hi' });

    expect(result).toStrictEqual({ isError: true, text: 'you are not in #checkout. call join first.' });
  });

  it('posts as the bound name and returns the message id', async () => {
    const api = await harness.joined('checkout', 'api');
    await harness.joined('checkout', 'web');

    const result = await api.call('post', { room: 'checkout', text: '@web total is cents now' });

    const last = harness.store.readUnseen({ as: 'web', room: 'checkout' });
    const message = last.ok ? last.messages.at(-1) : undefined;
    expect(result).toStrictEqual({ isError: false, text: `posted #${message?.id} in #checkout, mentioned @web.` });
    expect(message).toMatchObject({ from: 'api', mentions: ['web'], text: '@web total is cents now' });
  });

  it('names the count and the sender of lines that crossed the post', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await web.call('post', { room: 'checkout', text: 'which unit is total in?' });

    const result = await api.call('post', { room: 'checkout', text: 'total is cents now' });

    expect(result.text).toMatch(
      /^posted #\d+ in #checkout\. 1 new from web since your last read, call read_since before you go on\.$/,
    );
  });

  it('counts every crossed line and names each sender once', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    const mobile = await harness.joined('checkout', 'mobile');
    await web.call('post', { room: 'checkout', text: '@api which unit?' });
    await mobile.call('post', { room: 'checkout', text: '@api and the currency?' });
    await web.call('post', { room: 'checkout', text: '@api also tax?' });

    const result = await api.call('post', { room: 'checkout', text: '@web cents' });

    expect(result.text).toMatch(
      /^posted #\d+ in #checkout, mentioned @web\. 3 new from web and mobile since your last read, call read_since before you go on\.$/,
    );
  });

  it('leaves out lines that do not concern the poster', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await harness.joined('checkout', 'mobile');
    await web.call('post', { room: 'checkout', text: '@mobile ship first' });

    const result = await api.call('post', { room: 'checkout', text: 'total is cents now' });

    expect(result.text).toMatch(/^posted #\d+ in #checkout\.$/);
  });

  it('reads as plain posted once read_since caught up', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await web.call('post', { room: 'checkout', text: 'which unit is total in?' });
    await api.call('read_since', { room: 'checkout' });

    const result = await api.call('post', { room: 'checkout', text: 'total is cents now' });

    expect(result.text).toMatch(/^posted #\d+ in #checkout\.$/);
  });

  it('refuses text over 4,000 chars and says to post a path', async () => {
    const api = await harness.joined('checkout', 'api');

    const result = await api.call('post', { room: 'checkout', text: 'x'.repeat(4001) });

    expect(result).toStrictEqual({
      isError: true,
      text: 'too long (4001 chars). Write it to a file and post the path.',
    });
  });

  it('refuses a post once every agent is done, with the reopen hint', async () => {
    const api = await harness.joined('checkout', 'api');
    const web = await harness.joined('checkout', 'web');
    await api.call('post', { done: true, room: 'checkout', text: 'my part is in' });
    await web.call('post', { done: true, room: 'checkout', text: 'mine too' });

    const result = await api.call('post', { room: 'checkout', text: 'one more thing' });

    expect(result).toStrictEqual({
      isError: true,
      text: '#checkout is closed, every agent said done. ask the human to post or reopen it.',
    });
  });

  it('says call join first after the session left', async () => {
    const api = await harness.joined('checkout', 'api');
    await api.call('leave', { room: 'checkout' });

    const result = await api.call('post', { room: 'checkout', text: 'hi' });

    expect(result.text).toBe('you are not in #checkout. call join first.');
  });
});
