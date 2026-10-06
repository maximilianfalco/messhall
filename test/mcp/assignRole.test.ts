import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpHarness, type McpHarness } from './harness.js';

let harness: McpHarness;

beforeEach(() => {
  harness = mcpHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const roleOf = (name: string) =>
  harness.store.listMembers('dev').find(member => member.name === name)?.role;

describe('assign_role', () => {
  it('lets the orchestrator set a role, which list_members then shows', async () => {
    const orchestrator = await harness.joined('dev', 'orchestrator');
    const reviewer = await harness.joined('dev', 'reviewer-1');

    const result = await orchestrator.call('assign_role', { member: 'reviewer-1', role: 'reviewer', room: 'dev' });
    const listed = await reviewer.call('list_members', { room: 'dev' });

    expect(result).toStrictEqual({ isError: false, text: 'reviewer-1 is now reviewer in #dev.' });
    expect(listed.text).toContain('- reviewer-1 (messhall-in-memory 0.1.0, reviewer, active, you), last seen');
    expect(listed.text).toContain('- orchestrator (messhall-in-memory 0.1.0, orchestrator, active), last seen');
  });

  it('takes a free slug as a role', async () => {
    const orchestrator = await harness.joined('dev', 'orchestrator');
    await harness.joined('dev', 'web');

    await orchestrator.call('assign_role', { member: 'web', role: 'release-captain', room: 'dev' });

    expect(roleOf('web')).toBe('release-captain');
  });

  it('refuses a member who is not an orchestrator and changes nothing', async () => {
    const api = await harness.joined('dev', 'api');
    await harness.joined('dev', 'web');

    const result = await api.call('assign_role', { member: 'web', role: 'reviewer', room: 'dev' });
    const self = await api.call('assign_role', { member: 'api', role: 'orchestrator', room: 'dev' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'only the human or an orchestrator can set roles in #dev. ask @orchestrator or the human.',
    });
    expect(self.isError).toBe(true);
    expect([roleOf('api'), roleOf('web')]).toStrictEqual(['unassigned', 'unassigned']);
  });

  it('says call join first before a join', async () => {
    const outsider = await harness.agent();

    const result = await outsider.call('assign_role', { member: 'web', role: 'reviewer', room: 'dev' });

    expect(result).toStrictEqual({ isError: true, text: 'you are not in #dev. call join first.' });
  });

  it('refuses a member who is not in the room, with the next step', async () => {
    const orchestrator = await harness.joined('dev', 'orchestrator');

    const result = await orchestrator.call('assign_role', { member: 'ghost', role: 'reviewer', room: 'dev' });

    expect(result).toStrictEqual({
      isError: true,
      text: 'no member ghost in #dev. call list_members to see who is here.',
    });
  });
});
