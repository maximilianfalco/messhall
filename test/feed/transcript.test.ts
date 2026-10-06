import type { Member, RoomSummary } from '../../contracts/room.ts';
import type { TranscriptMessage } from '../../src/feed/transcript.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderTranscript } from '../../src/feed/transcript.js';

const AT = '2026-01-01T10:04:00.000Z';

const room = (overrides: Partial<RoomSummary> = {}): RoomSummary => ({
  closed_at: null,
  created_at: '2026-01-01T10:00:00.000Z',
  created_by: 'api',
  id: 'room-1',
  message_cap: 200,
  message_count: 3,
  name: 'checkout',
  standing: false,
  topic: 'agree the v2 checkout contract',
  ...overrides,
});

const member = (overrides: Partial<Member> = {}): Member => ({
  cursor: 0,
  done: false,
  joined_at: AT,
  kind: 'claude',
  last_seen_at: AT,
  left_at: null,
  name: 'api',
  presence: 'active',
  room_id: 'room-1',
  ...overrides,
});

const message = (overrides: Partial<TranscriptMessage> = {}): TranscriptMessage => ({
  created_at: AT,
  from: 'api',
  id: 1,
  kind: 'chat',
  mentions: [],
  room_id: 'room-1',
  text: 'hello',
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('renderTranscript', () => {
  it('renders the header, members and one line per message', () => {
    const markdown = renderTranscript({
      members: [member(), member({ kind: 'codex', name: 'web' }), member({ kind: 'human', name: 'human' })],
      messages: [
        message({ from: 'messhall', id: 1, kind: 'system', text: 'web joined' }),
        message({ id: 2, mentions: ['web'], text: '@web schema is ready' }),
        message({ from: 'human', id: 3, text: 'ship it' }),
        message({ from: 'web', id: 4, kind: 'done', text: 'shipped' }),
        message({ from: 'messhall', id: 5, kind: 'summary', text: 'goal: v2\nopen: none' }),
      ],
      room: room({ closed_at: '2026-01-01T11:30:00.000Z' }),
    });

    expect(markdown).toBe(
      [
        '# #checkout',
        '',
        'agree the v2 checkout contract',
        '',
        'created 2026-01-01 10:00, closed 2026-01-01 11:30, 3 posts',
        '',
        '## Members',
        '',
        '- api (claude)',
        '- web (codex)',
        '- human (human)',
        '',
        '## Messages',
        '',
        '- **10:04** *web joined*',
        '- **10:04** `api` → @web: @web schema is ready',
        '- **10:04** `human`: ship it',
        '- **10:04** `web`: ✓ shipped',
        '- **10:04** `messhall` (summary):',
        '',
        '  > goal: v2',
        '  > open: none',
        '',
      ].join('\n'),
    );
  });

  it('says when the room has no topic, is still open and has no messages', () => {
    const markdown = renderTranscript({ members: [], messages: [], room: room({ message_count: 0, topic: null }) });

    expect(markdown).toBe(
      [
        '# #checkout',
        '',
        'no topic',
        '',
        'created 2026-01-01 10:00, still open, 0 posts',
        '',
        '## Members',
        '',
        '- nobody',
        '',
        '## Messages',
        '',
        '- nothing yet',
        '',
      ].join('\n'),
    );
  });

  it('keeps a multi line message inside its list item', () => {
    const markdown = renderTranscript({ members: [], messages: [message({ text: 'one\ntwo' })], room: room() });

    expect(markdown).toContain('- **10:04** `api`: one\n  two\n');
  });
});
