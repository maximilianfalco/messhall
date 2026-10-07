import { describe, expect, it } from 'vitest';

import { busEventSchema, MEMBER_CHANGES, ROOM_CHANGES } from '../../contracts/events.ts';
import { FEED_CONTRACT_VERSION } from '../../contracts/feed.ts';
import {
  AGREEMENT_STATES,
  APPROVAL_STATES,
  MEMBER_KINDS,
  MESSAGE_KINDS,
  PRESENCES,
  QUESTION_STATES,
} from '../../contracts/room.ts';
import { contractSchema } from '../../tools/dev/commands/schema.js';

describe('FEED_CONTRACT_VERSION', () => {
  it('moves with the feed enums, bump it when one of them grows', () => {
    expect({
      enums: {
        AGREEMENT_STATES,
        APPROVAL_STATES,
        MEMBER_CHANGES,
        MEMBER_KINDS,
        MESSAGE_KINDS,
        PRESENCES,
        QUESTION_STATES,
        ROOM_CHANGES,
      },
      event_types: busEventSchema.options.map(option => option.shape.type.value),
      version: FEED_CONTRACT_VERSION,
    }).toMatchInlineSnapshot(`
      {
        "enums": {
          "AGREEMENT_STATES": [
            "open",
            "settled",
            "rejected",
            "replaced",
          ],
          "APPROVAL_STATES": [
            "pending",
            "allowed",
            "denied",
            "expired",
          ],
          "MEMBER_CHANGES": [
            "invited",
            "joined",
            "left",
            "muted",
            "reconnected",
            "removed",
            "role",
            "status",
            "unmuted",
          ],
          "MEMBER_KINDS": [
            "claude",
            "codex",
            "other",
            "human",
          ],
          "MESSAGE_KINDS": [
            "chat",
            "system",
            "done",
            "summary",
          ],
          "PRESENCES": [
            "invited",
            "active",
            "waiting",
            "idle",
            "away",
            "left",
          ],
          "QUESTION_STATES": [
            "open",
            "answered",
            "expired",
            "replaced",
          ],
          "ROOM_CHANGES": [
            "created",
            "closed",
            "reopened",
            "topic",
          ],
        },
        "event_types": [
          "message",
          "member",
          "presence",
          "room",
          "approval",
          "question",
          "agreement",
        ],
        "version": 5,
      }
    `);
  });

  it('is in schema.json as x-current on Snapshot.contract_version', () => {
    const schema = JSON.parse(contractSchema()) as {
      $defs: { Snapshot: { properties: { contract_version: Record<string, unknown> } } };
    };

    expect(schema.$defs.Snapshot.properties.contract_version['x-current']).toBe(FEED_CONTRACT_VERSION);
  });
});
