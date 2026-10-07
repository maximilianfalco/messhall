import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scratchStore } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  ['api', 'web', 'mobile'].forEach(as => scratch.store.joinRoom({ as, kind: 'claude', room: 'demo' }));
  scratch.store.ensureHuman('demo');
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;

type ProposeArgs = Parameters<ReturnType<typeof scratchStore>['store']['proposeAgreement']>[0];

const propose = (overrides: Partial<ProposeArgs> = {}) =>
  store().proposeAgreement({
    as: 'api',
    room: 'demo',
    text: 'amount_minor is integer cents',
    with: ['web', 'mobile'],
    ...overrides,
  });

const proposed = (overrides: Partial<ProposeArgs> = {}) => {
  const result = propose(overrides);
  if (!result.ok) throw new Error(result.reason);
  return result.agreement;
};

const confirm = (as: string, id: number) => store().confirmAgreement({ as, id, room: 'demo' });

const lastLine = () => {
  const page = store().listMessages({ limit: 1, room: 'demo' });
  return page.ok ? page.messages[0] : undefined;
};

const agreementEvents = (events: SequencedEvent[]) =>
  events.flatMap(({ event }) =>
    event.type === 'agreement' ? [[event.agreement.id, event.agreement.state, event.agreement.confirmed]] : [],
  );

describe('proposeAgreement', () => {
  it('posts the proposal as the proposer line that rings the named agents and keeps it open under that line id', () => {
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const agreement = proposed();

    expect(agreement).toStrictEqual({
      confirmed: [],
      created_at: agreement.created_at,
      decided_at: null,
      id: lastLine()!.id,
      proposer: 'api',
      rejected_by: null,
      replaces: null,
      room: 'demo',
      state: 'open',
      text: 'amount_minor is integer cents',
      why: null,
      with: ['web', 'mobile'],
    });
    expect(lastLine()).toMatchObject({
      from: 'api',
      kind: 'chat',
      mentions: ['web', 'mobile'],
      text: '@web @mobile proposal to confirm or reject: amount_minor is integer cents',
    });
    expect(agreementEvents(seen)).toStrictEqual([[agreement.id, 'open', []]]);
  });

  it('names each confirmer once', () => {
    expect(proposed({ with: ['web', 'web'] }).with).toStrictEqual(['web']);
  });

  it.each([
    ['not_member', { as: 'ghost' }],
    ['no_room', { room: 'nowhere' }],
    ['self', { with: ['api', 'web'] }],
  ] as const)('refuses with %s', (reason, overrides) => {
    expect(propose(overrides)).toStrictEqual({ ok: false, reason });
  });

  it('refuses names that are not agents in the room and says which', () => {
    expect(propose({ with: ['web', 'ghost', 'human'] })).toStrictEqual({
      missing: ['ghost', 'human'],
      ok: false,
      reason: 'not_in_room',
    });
  });

  it('refuses a muted proposer', () => {
    store().muteMember({ by: 'human', member: 'api', muted: true, room: 'demo' });

    expect(propose()).toStrictEqual({ ok: false, reason: 'muted' });
  });

  it('refuses in a closed room', () => {
    store().closeRoom('demo');

    expect(propose()).toStrictEqual({ ok: false, reason: 'room_closed' });
  });
});

describe('confirmAgreement', () => {
  it('records a named agent and keeps the agreement open until all named agents confirm', () => {
    const { id } = proposed();

    const result = confirm('web', id);

    expect(result.ok && [result.agreement.state, result.agreement.confirmed]).toStrictEqual(['open', ['web']]);
  });

  it('settles when every named agent confirms, with a messhall line that names the proposer', () => {
    const seen: SequencedEvent[] = [];
    const { id } = proposed();
    store().events.on(event => seen.push(event));

    confirm('mobile', id);
    const result = confirm('web', id);

    expect(result.ok && result.agreement).toMatchObject({ confirmed: ['mobile', 'web'], state: 'settled' });
    expect(result.ok && result.agreement.decided_at).not.toBeNull();
    expect(lastLine()).toMatchObject({
      from: 'messhall',
      kind: 'system',
      mentions: ['api'],
      text: `@api agreement #${id} is settled, confirmed by mobile and web`,
    });
    expect(agreementEvents(seen)).toStrictEqual([
      [id, 'open', ['mobile']],
      [id, 'settled', ['mobile', 'web']],
    ]);
  });

  it.each([
    ['the proposer', 'api'],
    ['an agent it does not name', 'mobile'],
  ])('refuses %s', (_case, as) => {
    const { id } = proposed({ with: ['web'] });

    expect(confirm(as, id)).toStrictEqual({ ok: false, reason: 'not_named' });
  });

  it('refuses a second confirm from the same agent', () => {
    const { id } = proposed();
    confirm('web', id);

    expect(confirm('web', id)).toStrictEqual({ ok: false, reason: 'already_confirmed' });
  });

  it('refuses an agreement that is no longer open', () => {
    const { id } = proposed({ with: ['web'] });
    confirm('web', id);

    expect(confirm('web', id)).toStrictEqual({ ok: false, reason: 'not_open' });
  });

  it('refuses an id that is not an agreement in the room', () => {
    expect(confirm('web', 9999)).toStrictEqual({ ok: false, reason: 'no_agreement' });
  });

  it('refuses a muted agent', () => {
    const { id } = proposed();
    store().muteMember({ by: 'human', member: 'web', muted: true, room: 'demo' });

    expect(confirm('web', id)).toStrictEqual({ ok: false, reason: 'muted' });
  });
});

describe('rejectAgreement', () => {
  it('reopens a settled agreement as rejected, with the why as the rejecter line to the proposer', () => {
    const { id } = proposed({ with: ['web'] });
    confirm('web', id);

    const result = store().rejectAgreement({ as: 'web', id, room: 'demo', why: 'mobile reads total as a float' });

    expect(result.ok && result.agreement).toMatchObject({
      rejected_by: 'web',
      state: 'rejected',
      why: 'mobile reads total as a float',
    });
    expect(lastLine()).toMatchObject({
      from: 'web',
      kind: 'chat',
      mentions: ['api'],
      text: `@api rejects agreement #${id}: mobile reads total as a float`,
    });
    expect(store().agreementsIn('demo')).toStrictEqual([]);
  });

  it('refuses an agent the agreement does not name', () => {
    const { id } = proposed({ with: ['web'] });

    expect(store().rejectAgreement({ as: 'mobile', id, room: 'demo', why: 'no' })).toStrictEqual({
      ok: false,
      reason: 'not_named',
    });
  });

  it('refuses an agreement already rejected', () => {
    const { id } = proposed({ with: ['web'] });
    store().rejectAgreement({ as: 'web', id, room: 'demo', why: 'no' });

    expect(store().rejectAgreement({ as: 'web', id, room: 'demo', why: 'no' })).toStrictEqual({
      ok: false,
      reason: 'not_open',
    });
  });
});

describe('a proposal that replaces another', () => {
  it('marks the old agreement replaced and names it on the new line', () => {
    const old = proposed({ with: ['web'] });
    confirm('web', old.id);

    const newer = proposed({ as: 'web', replaces: old.id, text: 'amount_minor and currency', with: ['api'] });

    expect(newer.replaces).toBe(old.id);
    expect(lastLine()?.text).toBe(`@api proposal to confirm or reject, replaces #${old.id}: amount_minor and currency`);
    expect(
      store()
        .agreementsIn('demo')
        .map(item => [item.id, item.state]),
    ).toStrictEqual([[newer.id, 'open']]);
  });

  it('refuses a replacer the old agreement does not involve', () => {
    const old = proposed({ with: ['web'] });

    expect(propose({ as: 'mobile', replaces: old.id, with: ['api'] })).toStrictEqual({
      ok: false,
      reason: 'not_named',
    });
  });

  it('refuses to replace an agreement that is rejected or missing', () => {
    const old = proposed({ with: ['web'] });
    store().rejectAgreement({ as: 'web', id: old.id, room: 'demo', why: 'no' });

    expect(propose({ replaces: old.id })).toStrictEqual({ ok: false, reason: 'not_open' });
    expect(propose({ replaces: 9999 })).toStrictEqual({ ok: false, reason: 'no_agreement' });
  });
});

describe('agreementsIn', () => {
  it('lists open and settled agreements oldest first, and none from another room', () => {
    const settled = proposed({ with: ['web'] });
    confirm('web', settled.id);
    const open = proposed({ text: 'refunds carry amount_minor too' });
    store().joinRoom({ as: 'api', kind: 'claude', room: 'other' });
    store().joinRoom({ as: 'web', kind: 'claude', room: 'other' });
    store().proposeAgreement({ as: 'api', room: 'other', text: 'elsewhere', with: ['web'] });

    expect(
      store()
        .agreementsIn('demo')
        .map(item => [item.id, item.state]),
    ).toStrictEqual([
      [settled.id, 'settled'],
      [open.id, 'open'],
    ]);
  });
});
