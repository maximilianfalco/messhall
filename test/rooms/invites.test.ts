import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INVITE_TTL_MS } from '../../src/config.js';

import { scratchStore } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.createRoom({ created_by: 'human', name: 'demo' });
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;
const LAUNCH = { agent: 'claude', cwd: '/tmp/api' } as const;
const texts = () =>
  store()
    .listMessages({ limit: 50, room: 'demo' })
    .messages!.map(message => `${message.from}: ${message.text}`);
const memberOf = (name: string) =>
  store()
    .listMembers('demo')
    .find(member => member.name === name);

function invite(input: Partial<Parameters<ReturnType<typeof scratchStore>['store']['invite']>[0]> = {}) {
  return store().invite({ by: 'human', launch: LAUNCH, name: 'api', role: 'worker', room: 'demo', ...input });
}

function seated(name: string, role: string) {
  store().joinRoom({ as: name, kind: 'claude', room: 'demo' });
  store().assignRole({ by: 'human', member: name, role, room: 'demo' });
}

describe('invite', () => {
  it('writes an invited seat with its role, instructions, who invited it, launch spec and a fresh seat key', () => {
    const made = invite({ instructions: 'build the api', launch: { ...LAUNCH, brief: 'b.md', model: 'opus' } });

    expect(made).toMatchObject({
      ok: true,
      member: { kind: 'claude', name: 'api', presence: 'invited', role: 'worker' },
    });
    expect(made.ok && made.seatKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(store().roleOf({ name: 'api', room: 'demo' })).toStrictEqual({
      by: 'human',
      instructions: 'build the api',
      role: 'worker',
    });
    expect(store().launchOf({ name: 'api', room: 'demo' })).toStrictEqual({ ...LAUNCH, brief: 'b.md', model: 'opus' });
    expect(texts()).toContain('messhall: api invited by human as worker');
  });

  it('gives each invite its own seat key', () => {
    const a = invite({ name: 'api' });
    const b = invite({ name: 'web' });

    expect(a.ok && b.ok && a.seatKey !== b.seatKey).toBe(true);
  });

  it('takes the member kind from the launch agent', () => {
    invite({ launch: { agent: 'codex', cwd: '/tmp/web' }, name: 'web' });

    expect(memberOf('web')?.kind).toBe('codex');
  });

  it('emits an invited member event', () => {
    const events: SequencedEvent[] = [];
    store().events.on(event => events.push(event));

    invite();

    expect(events.map(({ event }) => event)).toContainEqual(
      expect.objectContaining({ change: 'invited', member: expect.objectContaining({ name: 'api' }), type: 'member' }),
    );
  });

  it('lets an orchestrator invite a worker', () => {
    seated('boss', 'orchestrator');

    expect(invite({ by: 'boss' }).ok).toBe(true);
    expect(store().roleOf({ name: 'api', room: 'demo' })?.by).toBe('boss');
  });

  it('refuses an orchestrator that tries to invite another orchestrator', () => {
    seated('boss', 'orchestrator');

    expect(invite({ by: 'boss', name: 'boss-2', role: 'orchestrator' })).toStrictEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(memberOf('boss-2')).toBeUndefined();
  });

  it('lets the human invite an orchestrator', () => {
    expect(invite({ name: 'boss', role: 'orchestrator' }).ok).toBe(true);
  });

  it('refuses a plain agent', () => {
    seated('web', 'worker');

    expect(invite({ by: 'web' })).toStrictEqual({ ok: false, reason: 'not_allowed' });
  });

  it('refuses a muted orchestrator', () => {
    seated('boss', 'orchestrator');
    store().muteMember({ by: 'human', member: 'boss', muted: true, room: 'demo' });

    expect(invite({ by: 'boss' })).toStrictEqual({ ok: false, reason: 'muted' });
  });

  it('refuses a name already in the room, and a reserved one', () => {
    seated('api', 'worker');

    expect(invite()).toMatchObject({ ok: false, reason: 'name_taken', suggestion: 'api-2' });
    expect(invite({ name: 'human' })).toStrictEqual({ ok: false, reason: 'name_reserved' });
  });

  it('refuses a room that is missing or closed', () => {
    expect(invite({ room: 'nope' })).toStrictEqual({ ok: false, reason: 'no_room' });
    store().closeRoom('demo');
    expect(invite()).toStrictEqual({ ok: false, reason: 'room_closed' });
  });
});

describe('the first call of an invited seat', () => {
  it('seats it with its role as joined, not reconnected, and lists it as a seat of its key', () => {
    const made = invite();
    if (!made.ok) throw new Error(made.reason);

    expect(store().seatsOf(made.seatKey)).toStrictEqual([{ kind: 'claude', name: 'api', room: 'demo' }]);
    const joined = store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: made.seatKey });

    expect(joined).toMatchObject({ change: 'joined', member: { presence: 'active', role: 'worker' }, ok: true });
    expect(texts()).toContain('messhall: api joined');
  });

  it('refuses the name to anyone without the seat key', () => {
    invite();

    expect(store().joinRoom({ as: 'api', holderDead: true, kind: 'claude', room: 'demo' })).toMatchObject({
      ok: false,
      reason: 'name_taken',
    });
    expect(store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: 'guess' })).toMatchObject({
      ok: false,
      reason: 'name_taken',
    });
  });

  it('takes a codex invite token as proof and keeps the thread id as the key from then on', () => {
    const made = invite({ launch: { agent: 'codex', cwd: '/tmp/web' }, name: 'web' });
    if (!made.ok) throw new Error(made.reason);

    const joined = store().joinRoom({
      as: 'web',
      invite: made.seatKey,
      kind: 'codex',
      room: 'demo',
      seatKey: 'thread-1',
    });

    expect(joined).toMatchObject({ change: 'joined', member: { role: 'worker' }, ok: true });
    expect(store().seatsOf('thread-1')).toStrictEqual([{ kind: 'codex', name: 'web', room: 'demo' }]);
    expect(store().seatsOf(made.seatKey)).toStrictEqual([]);
  });

  it('refuses an invite token for a name with no invite', () => {
    expect(store().joinRoom({ as: 'web', invite: 'made-up', kind: 'codex', room: 'demo' })).toStrictEqual({
      ok: false,
      reason: 'no_invite',
    });
    expect(memberOf('web')).toBeUndefined();
  });
});

describe('invited seats and the clock', () => {
  it('drops an invite nobody took after 10 minutes, with a line and a removed event', () => {
    invite();
    const events: SequencedEvent[] = [];
    store().events.on(event => events.push(event));

    scratch.clock.advance(INVITE_TTL_MS - 1);
    expect(store().expireInvites()).toStrictEqual([]);
    scratch.clock.advance(1);
    expect(store().expireInvites()).toStrictEqual([{ name: 'api', room: 'demo' }]);

    expect(memberOf('api')).toBeUndefined();
    expect(texts()).toContain('messhall: api never came, invite dropped');
    expect(events.map(({ event }) => event)).toContainEqual(
      expect.objectContaining({ change: 'removed', type: 'member' }),
    );
  });

  it('keeps a seat whose agent came', () => {
    const made = invite();
    if (!made.ok) throw new Error(made.reason);
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo', seatKey: made.seatKey });

    scratch.clock.advance(INVITE_TTL_MS);

    expect(store().expireInvites()).toStrictEqual([]);
    expect(memberOf('api')?.presence).toBe('active');
  });

  it('leaves an invited seat alone in the presence sweep and at a restart', () => {
    invite();

    scratch.clock.advance(INVITE_TTL_MS - 1);
    store().sweepPresence();
    store().markAllAway();

    expect(memberOf('api')?.presence).toBe('invited');
  });
});
