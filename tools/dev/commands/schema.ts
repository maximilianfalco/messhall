import type { Command } from 'commander';

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  busEventSchema,
  memberEventSchema,
  messageEventSchema,
  presenceEventSchema,
  roomEventSchema,
  sequencedEventSchema,
} from '../../../contracts/events.ts';
import {
  closeResultSchema,
  feedErrorSchema,
  historySchema,
  humanPostResultSchema,
  humanPostSchema,
  newRoomResultSchema,
  newRoomSchema,
  reopenResultSchema,
  searchHitSchema,
  searchResultSchema,
  snapshotRoomSchema,
  snapshotSchema,
} from '../../../contracts/feed.ts';
import { healthSchema } from '../../../contracts/health.ts';
import {
  memberKindSchema,
  memberSchema,
  messageKindSchema,
  messageSchema,
  presenceSchema,
  roomSchema,
  roomSummarySchema,
} from '../../../contracts/room.ts';
import { REPO_ROOT } from '../lib/paths.js';
import { ok } from '../lib/print.js';

export const SCHEMA_PATH = path.join(REPO_ROOT, 'contracts', 'schema.json');

export const CONTRACTS = {
  BusEvent: busEventSchema,
  CloseResult: closeResultSchema,
  FeedError: feedErrorSchema,
  Health: healthSchema,
  History: historySchema,
  HumanPost: humanPostSchema,
  HumanPostResult: humanPostResultSchema,
  Member: memberSchema,
  MemberEvent: memberEventSchema,
  MemberKind: memberKindSchema,
  Message: messageSchema,
  MessageEvent: messageEventSchema,
  MessageKind: messageKindSchema,
  NewRoom: newRoomSchema,
  NewRoomResult: newRoomResultSchema,
  Presence: presenceSchema,
  PresenceEvent: presenceEventSchema,
  ReopenResult: reopenResultSchema,
  Room: roomSchema,
  RoomEvent: roomEventSchema,
  RoomSummary: roomSummarySchema,
  SearchHit: searchHitSchema,
  SearchResult: searchResultSchema,
  SequencedEvent: sequencedEventSchema,
  Snapshot: snapshotSchema,
  SnapshotRoom: snapshotRoomSchema,
} satisfies Record<string, z.ZodType>;

/** Every wire contract as one JSON Schema document, one `$defs` entry each, for the Swift models. */
export function contractSchema() {
  const registry = z.registry<{ id: string }>();
  Object.entries(CONTRACTS).forEach(([id, schema]) => registry.add(schema, { id }));
  const { schemas } = z.toJSONSchema(registry, { uri: id => `#/$defs/${id}` });
  const defs = Object.fromEntries(
    Object.entries(schemas).map(([id, { $id: _id, $schema: _schema, ...definition }]) => [id, definition]),
  );
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'messhall contracts',
    $defs: defs,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Registers `schema`, which writes `contracts/schema.json`. */
export function registerSchema(program: Command) {
  program
    .command('schema')
    .description('Write contracts/schema.json from the zod contracts, one definition per contract.')
    .action(() => {
      writeFileSync(SCHEMA_PATH, contractSchema());
      console.log(ok(`wrote ${path.relative(REPO_ROOT, SCHEMA_PATH)}, ${Object.keys(CONTRACTS).length} contracts`));
    });
}
