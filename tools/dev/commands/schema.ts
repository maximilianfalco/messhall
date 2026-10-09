import type { Command } from 'commander';

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  agreementEventSchema,
  approvalEventSchema,
  busEventSchema,
  memberEventSchema,
  messageEditEventSchema,
  messageEventSchema,
  presenceEventSchema,
  questionEventSchema,
  roomEventSchema,
  sequencedEventSchema,
} from '../../../contracts/events.ts';
import {
  answerResultSchema,
  approvalResultSchema,
  closeResultSchema,
  feedErrorSchema,
  flockSchema,
  flockSeatSchema,
  historySchema,
  humanPostResultSchema,
  humanAnswerSchema,
  humanApprovalSchema,
  humanPostSchema,
  humanRoleResultSchema,
  humanRoleSchema,
  humanSpawnSchema,
  muteResultSchema,
  newRoomResultSchema,
  newRoomSchema,
  removeMemberResultSchema,
  roomSuggestionSchema,
  runningAgentSchema,
  runningInviteItemSchema,
  runningInviteResultSchema,
  runningInviteSchema,
  runningSchema,
  reopenResultSchema,
  searchHitSchema,
  searchResultSchema,
  snapshotRoomSchema,
  snapshotSchema,
  spawnResultSchema,
} from '../../../contracts/feed.ts';
import { buildSchema, healthSchema } from '../../../contracts/health.ts';
import {
  agreementSchema,
  approvalSchema,
  memberKindSchema,
  memberSchema,
  messageKindSchema,
  messageSchema,
  presenceSchema,
  questionAnswerSchema,
  questionItemSchema,
  questionOptionSchema,
  questionSchema,
  roomSchema,
  roomSummarySchema,
} from '../../../contracts/room.ts';
import { REPO_ROOT } from '../lib/paths.js';
import { ok } from '../lib/print.js';

export const SCHEMA_PATH = path.join(REPO_ROOT, 'contracts', 'schema.json');

export const CONTRACTS = {
  Agreement: agreementSchema,
  AgreementEvent: agreementEventSchema,
  AnswerResult: answerResultSchema,
  Approval: approvalSchema,
  ApprovalEvent: approvalEventSchema,
  ApprovalResult: approvalResultSchema,
  Build: buildSchema,
  BusEvent: busEventSchema,
  CloseResult: closeResultSchema,
  FeedError: feedErrorSchema,
  Flock: flockSchema,
  FlockSeat: flockSeatSchema,
  Health: healthSchema,
  History: historySchema,
  HumanAnswer: humanAnswerSchema,
  HumanApproval: humanApprovalSchema,
  HumanPost: humanPostSchema,
  HumanPostResult: humanPostResultSchema,
  HumanRole: humanRoleSchema,
  HumanRoleResult: humanRoleResultSchema,
  HumanSpawn: humanSpawnSchema,
  Member: memberSchema,
  MemberEvent: memberEventSchema,
  MemberKind: memberKindSchema,
  MuteResult: muteResultSchema,
  Message: messageSchema,
  MessageEditEvent: messageEditEventSchema,
  MessageEvent: messageEventSchema,
  MessageKind: messageKindSchema,
  NewRoom: newRoomSchema,
  NewRoomResult: newRoomResultSchema,
  Presence: presenceSchema,
  PresenceEvent: presenceEventSchema,
  Question: questionSchema,
  QuestionAnswer: questionAnswerSchema,
  QuestionEvent: questionEventSchema,
  QuestionItem: questionItemSchema,
  QuestionOption: questionOptionSchema,
  RemoveMemberResult: removeMemberResultSchema,
  ReopenResult: reopenResultSchema,
  Room: roomSchema,
  RoomEvent: roomEventSchema,
  RoomSuggestion: roomSuggestionSchema,
  RoomSummary: roomSummarySchema,
  Running: runningSchema,
  RunningAgent: runningAgentSchema,
  RunningInvite: runningInviteSchema,
  RunningInviteItem: runningInviteItemSchema,
  RunningInviteResult: runningInviteResultSchema,
  SearchHit: searchHitSchema,
  SearchResult: searchResultSchema,
  SequencedEvent: sequencedEventSchema,
  Snapshot: snapshotSchema,
  SnapshotRoom: snapshotRoomSchema,
  SpawnResult: spawnResultSchema,
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
