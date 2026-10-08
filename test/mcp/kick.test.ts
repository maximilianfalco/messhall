import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const names = () => harness.store.listMembers('dev', { left: true }).map(member => member.name);

describe('kick', () => {
  it('lets the orchestrator drop an active seat at once', async () => {
    const orchestrator = await harness.orchestrator('dev');
    await harness.joined('dev', 'api');

    const result = await orchestrator.call('kick', { member: 'api', room: 'dev' });

    expect(result).toStrictEqual({ isError: false, text: 'api is out of #dev.' });
    expect(names()).toStrictEqual(['human', 'orchestrator']);
  });

  it('tells a kicked agent on its next call that it was removed, and lets it join again', async () => {
    const orchestrator = await harness.orchestrator('dev');
    const api = await harness.joined('dev', 'api');
    await orchestrator.call('kick', { member: 'api', room: 'dev' });

    const posted = await api.call('post', { room: 'dev', text: 'still here?' });
    const rejoined = await api.call('join', { as: 'api', room: 'dev' });

    expect(posted).toStrictEqual({
      isError: true,
      text: 'you were removed from #dev by the human or an orchestrator. call join to come back.',
    });
    expect(rejoined.text).toContain('joined #dev as api');
  });

  it.each(['read_since', 'my_role', 'wait'])('says removed on %s too', async tool => {
    const orchestrator = await harness.orchestrator('dev');
    const api = await harness.joined('dev', 'api');
    await orchestrator.call('kick', { member: 'api', room: 'dev' });

    const result = await api.call(tool, { room: 'dev', timeout_s: 1 });

    expect(result.text).toContain('you were removed from #dev');
  });

  it('refuses a member who is not an orchestrator and changes nothing', async () => {
    const api = await harness.joined('dev', 'api');
    await harness.joined('dev', 'web');

    const result = await api.call('kick', { member: 'web', room: 'dev' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'only the human or an orchestrator can kick in #dev. ask @orchestrator or the human.',
    });
    expect(names()).toStrictEqual(['api', 'human', 'web']);
  });

  it('refuses the human seat and a member who is not there', async () => {
    const orchestrator = await harness.orchestrator('dev');

    const human = await orchestrator.call('kick', { member: 'human', room: 'dev' });
    const ghost = await orchestrator.call('kick', { member: 'ghost', room: 'dev' });

    expect(human).toStrictEqual({ isError: true, text: 'the human seat cannot be kicked.' });
    expect(ghost).toStrictEqual({
      isError: true,
      text: 'no member ghost in #dev. call list_members to see who is here.',
    });
  });

  it('says call join first before a join', async () => {
    const outsider = await harness.agent();

    const result = await outsider.call('kick', { member: 'web', room: 'dev' });

    expect(result).toStrictEqual({ isError: true, text: 'you are not in #dev. call join first.' });
  });
});
