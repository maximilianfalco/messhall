import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const mutedOf = (name: string) => harness.store.listMembers('dev').find(member => member.name === name)?.muted;

describe('mute', () => {
  it('lets the orchestrator mute a member, whose post is then refused with the next step', async () => {
    const orchestrator = await harness.orchestrator('dev');
    const web = await harness.joined('dev', 'web');

    const result = await orchestrator.call('mute', { member: 'web', room: 'dev' });
    const post = await web.call('post', { room: 'dev', text: 'one more thing' });
    const listed = await orchestrator.call('list_members', { room: 'dev' });

    expect(result).toStrictEqual({ isError: false, text: 'web is muted in #dev.' });
    expect(post).toStrictEqual({
      isError: true,
      text: 'you are muted in #dev. you can still read and wait. post again once a messhall line says you are unmuted.',
    });
    expect(listed.text).toContain('- web (messhall-in-memory 0.1.0, active, muted), last seen');
  });

  it('unmutes with unmute: true, so the member posts again', async () => {
    const orchestrator = await harness.orchestrator('dev');
    const web = await harness.joined('dev', 'web');
    await orchestrator.call('mute', { member: 'web', room: 'dev' });

    const result = await orchestrator.call('mute', { member: 'web', room: 'dev', unmute: true });
    const post = await web.call('post', { room: 'dev', text: 'back' });

    expect(result).toStrictEqual({ isError: false, text: 'web is unmuted in #dev.' });
    expect(post.isError).toBe(false);
  });

  it('refuses a member who is not an orchestrator and mutes nobody', async () => {
    const api = await harness.joined('dev', 'api');
    await harness.joined('dev', 'web');

    const result = await api.call('mute', { member: 'web', room: 'dev' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'only the human or an orchestrator can mute in #dev. ask @orchestrator or the human.',
    });
    expect(mutedOf('web')).toBe(false);
  });

  it('refuses a muted orchestrator that tries to unmute itself', async () => {
    const orchestrator = await harness.orchestrator('dev');
    harness.store.muteMember({ by: 'human', member: 'orchestrator', muted: true, room: 'dev' });

    const result = await orchestrator.call('mute', { member: 'orchestrator', room: 'dev', unmute: true });

    expect(result).toStrictEqual({
      isError: true,
      text: 'you are muted in #dev, so you cannot mute or unmute. wait for the human to unmute you.',
    });
    expect(mutedOf('orchestrator')).toBe(true);
  });

  it('refuses the human seat', async () => {
    const orchestrator = await harness.orchestrator('dev');

    const result = await orchestrator.call('mute', { member: 'human', room: 'dev' });

    expect(result).toStrictEqual({ isError: true, text: 'the human cannot be muted.' });
  });

  it('refuses a member who is not in the room, with the next step', async () => {
    const orchestrator = await harness.orchestrator('dev');

    const result = await orchestrator.call('mute', { member: 'ghost', room: 'dev' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'no member ghost in #dev. call list_members to see who is here.',
    });
  });

  it('says call join first before a join', async () => {
    const outsider = await harness.agent();

    const result = await outsider.call('mute', { member: 'web', room: 'dev' });

    expect(result).toStrictEqual({ isError: true, text: 'you are not in #dev. call join first.' });
  });
});
