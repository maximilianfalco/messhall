import { describe, expect, it } from 'vitest';

import { createSession, createSessionRegistry } from '../../src/mcp/session.js';

const now = () => new Date('2026-10-09T00:00:00Z');

describe('createSessionRegistry peers', () => {
  it('lists the client ports each session holds open, with its seats', () => {
    const sessions = createSessionRegistry<{ session: ReturnType<typeof createSession> }>();
    const seated = createSession({ id: 'a', now });
    seated.bind({ kind: 'claude', name: 'api', room: 'dev' });
    const release = seated.hold(51001);
    seated.hold(51002);
    release();
    const idle = createSession({ id: 'b', now });
    idle.hold(51003);
    sessions.add({ session: seated });
    sessions.add({ session: idle });

    expect(sessions.peers()).toStrictEqual([{ kind: 'claude', ports: [51002], seats: [{ name: 'api', room: 'dev' }] }]);
  });

  it('keeps a port while another request on it is still open', () => {
    const session = createSession({ id: 'a', now });
    session.bind({ kind: 'codex', name: 'web', room: 'dev' });
    const first = session.hold(51001);
    session.hold(51001);
    first();

    expect(session.ports).toStrictEqual([51001]);
  });
});
