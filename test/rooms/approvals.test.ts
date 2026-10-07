import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APPROVAL_TTL_MS } from '../../src/config.js';

import { scratchStore } from './scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
});

afterEach(() => {
  scratch.cleanup();
});

const store = () => scratch.store;

const ask = (overrides: Partial<Parameters<ReturnType<typeof scratchStore>['store']['openApproval']>[0]> = {}) =>
  store().openApproval({
    description: 'List the files',
    inputPreview: '{"command": "ls -la"}',
    requestId: 'abcde',
    seats: [{ name: 'api', room: 'demo' }],
    session: 'session-1',
    tool: 'Bash',
    ...overrides,
  });

const approvalEvents = (events: SequencedEvent[]) =>
  events.flatMap(({ event }) => (event.type === 'approval' ? [[event.room, event.approval.state]] : []));

describe('openApproval', () => {
  it('stores a pending approval for the seat and puts it on the feed', () => {
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const [approval] = ask();

    expect(approval).toMatchObject({
      answered_at: null,
      description: 'List the files',
      input_preview: '{"command": "ls -la"}',
      member: 'api',
      room: 'demo',
      state: 'pending',
      tool: 'Bash',
    });
    expect(approvalEvents(seen)).toStrictEqual([['demo', 'pending']]);
    expect(store().pendingApprovals('demo')).toStrictEqual([approval]);
  });

  it('gives every room the session sits in the same approval id', () => {
    store().joinRoom({ as: 'api-2', kind: 'claude', room: 'other' });

    const approvals = ask({
      seats: [
        { name: 'api', room: 'demo' },
        { name: 'api-2', room: 'other' },
      ],
    });

    expect(approvals.map(approval => [approval.room, approval.member])).toStrictEqual([
      ['demo', 'api'],
      ['other', 'api-2'],
    ]);
    expect(new Set(approvals.map(approval => approval.id)).size).toBe(1);
  });

  it('stores nothing for a session with no seat', () => {
    expect(ask({ seats: [] })).toStrictEqual([]);
    expect(ask({ seats: [{ name: 'api', room: 'nowhere' }] })).toStrictEqual([]);
  });

  it('expires the older ask of the same session, since Claude Code opens one dialog at a time', () => {
    const [older] = ask();
    scratch.clock.advance(1000);
    ask({ requestId: 'other', session: 'session-2' });
    scratch.clock.advance(1000);

    ask({ requestId: 'fghij', tool: 'Write' });

    expect(
      store()
        .pendingApprovals('demo')
        .map(approval => approval.tool),
    ).toStrictEqual(['Bash', 'Write']);
    expect(
      store()
        .pendingApprovals('demo')
        .map(approval => approval.id),
    ).not.toContain(older!.id);
  });

  it('cuts a very long preview so one ask cannot fill the feed', () => {
    const [approval] = ask({ inputPreview: 'x'.repeat(50_000) });

    expect(approval!.input_preview.length).toBeLessThan(10_000);
  });
});

describe('answerApproval', () => {
  it('answers the exact id once and hands back the session and request id to relay to', () => {
    const [approval] = ask();

    const answered = store().answerApproval({ behavior: 'allow', id: approval!.id });

    expect(answered).toMatchObject({ ok: true, requestId: 'abcde', session: 'session-1' });
    expect(answered.ok && answered.approvals.map(row => row.state)).toStrictEqual(['allowed']);
    expect(store().pendingApprovals('demo')).toStrictEqual([]);
    expect(store().answerApproval({ behavior: 'deny', id: approval!.id })).toStrictEqual({
      ok: false,
      reason: 'no_approval',
    });
  });

  it('refuses an id it never issued', () => {
    ask();

    expect(store().answerApproval({ behavior: 'allow', id: 'abcde' })).toStrictEqual({
      ok: false,
      reason: 'no_approval',
    });
    expect(store().pendingApprovals('demo')).toHaveLength(1);
  });

  it('marks a deny as denied', () => {
    const [approval] = ask();

    const answered = store().answerApproval({ behavior: 'deny', id: approval!.id });

    expect(answered.ok && answered.approvals[0]!.state).toBe('denied');
  });
});

describe('expireApprovals', () => {
  it('expires an ask nobody answered in time and hands it back to deny', () => {
    const [approval] = ask();
    scratch.clock.advance(APPROVAL_TTL_MS - 1);
    expect(store().expireApprovals()).toStrictEqual([]);

    scratch.clock.advance(1);

    expect(store().expireApprovals()).toStrictEqual([{ requestId: 'abcde', session: 'session-1' }]);
    expect(store().pendingApprovals('demo')).toStrictEqual([]);
    expect(store().answerApproval({ behavior: 'allow', id: approval!.id })).toMatchObject({ ok: false });
  });

  it('expires only the asks of a session that ended', () => {
    ask();
    ask({ requestId: 'fghij', session: 'session-2' });

    expect(store().expireApprovals({ session: 'session-1' })).toStrictEqual([
      { requestId: 'abcde', session: 'session-1' },
    ]);
    expect(
      store()
        .pendingApprovals('demo')
        .map(approval => approval.tool),
    ).toStrictEqual(['Bash']);
  });

  it('lists one entry per ask even when it sits in two rooms', () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'other' });
    ask({
      seats: [
        { name: 'api', room: 'demo' },
        { name: 'api', room: 'other' },
      ],
    });
    scratch.clock.advance(APPROVAL_TTL_MS);

    expect(store().expireApprovals()).toHaveLength(1);
  });

  it('expires every pending ask on daemon start, since no session lives through a restart', () => {
    ask();

    store().markAllAway();

    expect(store().pendingApprovals('demo')).toStrictEqual([]);
  });
});
