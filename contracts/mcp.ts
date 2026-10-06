import { z } from 'zod';

import { nameSchema } from './room.ts';

export const AGENT_KINDS = ['claude', 'codex', 'other'] as const;
export const WAIT_MAX_S = 270;
export const NOTE_MAX_CHARS = 200;

const roomField = nameSchema.describe('Room name: lowercase letters, digits and dashes, 1 to 40 chars.');

export const joinInputSchema = z.object({
  as: nameSchema
    .optional()
    .describe(
      'Your role name in the room, like api or web. Defaults to the repo folder name when the client sends roots.',
    ),
  kind: z
    .enum(AGENT_KINDS)
    .optional()
    .describe('Which agent you are: claude, codex or other. Guessed from the client when left out.'),
  room: roomField.describe('Room to join. It is made on first join.'),
  thread_id: z
    .string()
    .min(1)
    .optional()
    .describe('For Codex: the value of $CODEX_THREAD_ID, so messhall can ring this session.'),
});

export const postInputSchema = z.object({
  done: z.boolean().optional().describe('True when your part is finished. Your next post puts you back in.'),
  room: roomField.describe('Room you joined.'),
  text: z.string().min(1).describe('Message text, at most 4,000 chars. Mention with @name or @all.'),
});

export const readSinceInputSchema = z.object({
  after_id: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Re-read from after this message id, for a lost result. Leaves your bookmark alone.'),
  room: roomField.describe('Room you joined.'),
});

export const waitInputSchema = z.object({
  room: roomField.optional().describe('Room to wait on. Left out, every room you joined.'),
  timeout_s: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Seconds to wait before giving up. Default 100, at most ${WAIT_MAX_S}, less for clients with a short tool timeout.`,
    ),
});

export const listMembersInputSchema = z.object({
  room: roomField.describe('Room to list. No need to join it first.'),
});

export const listRoomsInputSchema = z.object({});

export const leaveInputSchema = z.object({
  note: z.string().max(NOTE_MAX_CHARS).optional().describe('A short line the room sees as you go.'),
  room: roomField.describe('Room to leave.'),
});

export type JoinInput = z.infer<typeof joinInputSchema>;
export type PostInput = z.infer<typeof postInputSchema>;
export type ReadSinceInput = z.infer<typeof readSinceInputSchema>;
export type WaitInput = z.infer<typeof waitInputSchema>;
export type ListMembersInput = z.infer<typeof listMembersInputSchema>;
export type LeaveInput = z.infer<typeof leaveInputSchema>;
