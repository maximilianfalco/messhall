import { z } from 'zod';

import {
  approvalSchema,
  memberSchema,
  messageSchema,
  nameSchema,
  presenceSchema,
  roomSchema,
  timestampSchema,
} from './room.ts';

export const MEMBER_CHANGES = [
  'invited',
  'joined',
  'left',
  'muted',
  'reconnected',
  'removed',
  'role',
  'unmuted',
] as const;
export const ROOM_CHANGES = ['created', 'closed', 'reopened', 'topic'] as const;

export type MemberChange = (typeof MEMBER_CHANGES)[number];
export type RoomChange = (typeof ROOM_CHANGES)[number];

export const messageEventSchema = z.object({
  message: messageSchema.describe('The new message.'),
  room: nameSchema.describe('Room name.'),
  type: z.literal('message').describe('A message was posted.'),
});

export const memberEventSchema = z.object({
  change: z
    .enum(MEMBER_CHANGES)
    .describe(
      'invited when its seat was made ahead, joined, left, reconnected, removed when it left 5 minutes ago, its invite went unused or the human or an orchestrator kicked it, role when its role was set, or muted and unmuted.',
    ),
  member: memberSchema.describe('The member after the change.'),
  room: nameSchema.describe('Room name.'),
  type: z.literal('member').describe('A member was invited, came, went, dropped out, got a role or was muted.'),
});

export const presenceEventSchema = z.object({
  from: presenceSchema.describe('Presence before.'),
  name: nameSchema.describe('Member name.'),
  room: nameSchema.describe('Room name.'),
  to: presenceSchema.describe('Presence after.'),
  type: z.literal('presence').describe('A member changed presence.'),
});

export const roomEventSchema = z.object({
  change: z.enum(ROOM_CHANGES).describe('created, closed, reopened or topic.'),
  room: roomSchema.describe('The room after the change.'),
  type: z.literal('room').describe('A room changed.'),
});

export const approvalEventSchema = z.object({
  approval: approvalSchema.describe('The approval after the change.'),
  room: nameSchema.describe('Room name.'),
  type: z.literal('approval').describe('An agent asked to use a tool, or its ask was answered or expired.'),
});

export const busEventSchema = z
  .discriminatedUnion('type', [
    messageEventSchema,
    memberEventSchema,
    presenceEventSchema,
    roomEventSchema,
    approvalEventSchema,
  ])
  .describe('One change in the room store.');

export const sequencedEventSchema = z.object({
  created_at: timestampSchema.describe('When it happened.'),
  event: busEventSchema.describe('What happened.'),
  seq: z.number().int().positive().describe('Global event sequence, for replay.'),
});

export type BusEvent = z.infer<typeof busEventSchema>;
export type SequencedEvent = z.infer<typeof sequencedEventSchema>;
