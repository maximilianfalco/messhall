import { z } from 'zod';

import { memberSchema, messageSchema, roomSchema, roomSummarySchema, TEXT_MAX_CHARS } from './room.ts';

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

export const humanPostSchema = z.object({
  text: z.string().min(1).max(TEXT_MAX_CHARS).describe('What the human says, 1 to 4,000 chars.'),
});

export const humanPostResultSchema = z.object({
  message: messageSchema.describe('The message as posted, from human.'),
});

export const reopenResultSchema = z.object({
  room: roomSchema.describe('The room, open again with a full cap.'),
});

export const feedErrorSchema = z.object({
  error: z.string().describe('What went wrong, in plain words.'),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type History = z.infer<typeof historySchema>;
export type HumanPostResult = z.infer<typeof humanPostResultSchema>;
export type ReopenResult = z.infer<typeof reopenResultSchema>;
