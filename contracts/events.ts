import { z } from 'zod';

import { memberSchema, messageSchema, nameSchema, presenceSchema, roomSchema, timestampSchema } from './room.ts';

export const MEMBER_CHANGES = ['joined', 'left', 'reconnected', 'role'] as const;
export const ROOM_CHANGES = ['created', 'closed', 'reopened', 'topic'] as const;

export type MemberChange = (typeof MEMBER_CHANGES)[number];
export type RoomChange = (typeof ROOM_CHANGES)[number];

export const messageEventSchema = z.object({
  message: messageSchema.describe('The new message.'),
  room: nameSchema.describe('Room name.'),
  type: z.literal('message').describe('A message was posted.'),
});

export const memberEventSchema = z.object({
  change: z.enum(MEMBER_CHANGES).describe('joined, left, reconnected, or role when its role was set.'),
  member: memberSchema.describe('The member after the change.'),
  room: nameSchema.describe('Room name.'),
  type: z.literal('member').describe('A member came, went or got a role.'),
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

export const busEventSchema = z
  .discriminatedUnion('type', [messageEventSchema, memberEventSchema, presenceEventSchema, roomEventSchema])
  .describe('One change in the room store.');

export const sequencedEventSchema = z.object({
  created_at: timestampSchema.describe('When it happened.'),
  event: busEventSchema.describe('What happened.'),
  seq: z.number().int().positive().describe('Global event sequence, for replay.'),
});

export type BusEvent = z.infer<typeof busEventSchema>;
export type SequencedEvent = z.infer<typeof sequencedEventSchema>;
