import { z } from 'zod';

import {
  INSTRUCTIONS_MAX_CHARS,
  memberSchema,
  messageSchema,
  nameSchema,
  roleSchema,
  roomSchema,
  roomSummarySchema,
  TEXT_MAX_CHARS,
} from './room.ts';

export const TOPIC_MAX_CHARS = 200;

export const SNAPSHOT_EVENT = 'snapshot';

export const snapshotRoomSchema = roomSummarySchema.extend({
  members: z.array(memberSchema).describe('Members still in the room, by name, the human seat too.'),
  messages: z.array(messageSchema).describe('The last 50 messages, oldest first, system lines too.'),
});

export const snapshotSchema = z.object({
  rooms: z.array(snapshotRoomSchema).describe('Every room, open or closed, by name.'),
  seq: z
    .number()
    .int()
    .nonnegative()
    .describe('The event sequence this snapshot is current to. Resume the feed after it.'),
});

export const historySchema = z.object({
  messages: z.array(messageSchema).describe('One page of a room, oldest first.'),
});

export const searchHitSchema = messageSchema.extend({
  room: nameSchema.describe('Name of the room the message is in.'),
});

export const searchResultSchema = z.object({
  messages: z.array(searchHitSchema).describe('Messages that have every word searched for, newest first.'),
});

export const humanPostSchema = z.object({
  text: z.string().min(1).max(TEXT_MAX_CHARS).describe('What the human says, 1 to 4,000 chars.'),
});

export const humanPostResultSchema = z.object({
  message: messageSchema.describe('The message as posted, from human.'),
});

export const reopenResultSchema = z.object({
  room: roomSchema.describe('The room, open again with a full cap.'),
});

export const newRoomSchema = z.object({
  cap: z.number().int().positive().optional().describe('Posts allowed before the room closes, 200 when left out.'),
  name: nameSchema.describe('Room name, unique.'),
  topic: z.string().min(1).max(TOPIC_MAX_CHARS).optional().describe('What the room is for, 1 to 200 chars.'),
});

export const newRoomResultSchema = z.object({
  room: roomSchema.describe('The new room, standing and made by human.'),
});

export const closeResultSchema = z.object({
  room: roomSchema.describe('The room, closed until the human reopens it.'),
});

export const humanRoleSchema = z.object({
  instructions: z
    .string()
    .min(1)
    .max(INSTRUCTIONS_MAX_CHARS)
    .optional()
    .describe('What the member should do in this role, 1 to 4,000 chars. Left out clears any earlier ones.'),
  role: roleSchema.describe('The role to give the member.'),
});

export const humanRoleResultSchema = z.object({
  member: memberSchema.describe('The member with its new role.'),
  message: messageSchema.describe('The line from human that mentions the member, so it reads its role.'),
});

export const feedErrorSchema = z.object({
  error: z.string().describe('What went wrong, in plain words.'),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type History = z.infer<typeof historySchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type HumanPostResult = z.infer<typeof humanPostResultSchema>;
export type ReopenResult = z.infer<typeof reopenResultSchema>;
export type NewRoomResult = z.infer<typeof newRoomResultSchema>;
export type CloseResult = z.infer<typeof closeResultSchema>;
export type HumanRole = z.infer<typeof humanRoleSchema>;
export type HumanRoleResult = z.infer<typeof humanRoleResultSchema>;
