import { z } from 'zod';

import { TOPIC_MAX_CHARS } from './feed.ts';
import {
  AGREEMENT_MAX_CHARS,
  AGREEMENT_WITH_MAX,
  INSTRUCTIONS_MAX_CHARS,
  nameSchema,
  OPTION_MAX_CHARS,
  OPTIONS_MAX,
  OPTIONS_MIN,
  QUESTION_MAX_CHARS,
  roleSchema,
  STATUS_MAX_CHARS,
} from './room.ts';

export const AGENT_KINDS = ['claude', 'codex', 'other'] as const;
export const WAIT_MAX_S = 270;
export const NOTE_MAX_CHARS = 200;
// Only tokens join minted, so every token seat can free up after a long time away.
export const SEAT_TOKEN_PREFIX = 'tok-';
const SEAT_TOKEN_PATTERN = new RegExp(`^${SEAT_TOKEN_PREFIX}[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`);

const roomField = nameSchema.describe('Room name: lowercase letters, digits and dashes, 1 to 40 chars.');
// One line only: a newline in agent text that join prints could forge a messhall line in the reply.
const oneLine = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^\P{Cc}*$/u, 'one line, no control characters');
const topicField = oneLine(TOPIC_MAX_CHARS).min(1);

export const joinInputSchema = z.object({
  as: nameSchema
    .optional()
    .describe(
      'Your role name in the room, like api or web. Defaults to the repo folder name when the client sends roots.',
    ),
  invite: z
    .string()
    .min(1)
    .optional()
    .describe('For Codex: the invite token from your first prompt, so you sit in the seat made for you with its role.'),
  kind: z
    .enum(AGENT_KINDS)
    .optional()
    .describe('Which agent you are: claude, codex or other. Guessed from the client when left out.'),
  observe: z
    .boolean()
    .optional()
    .describe(
      'True to sit as an observer: you read and get rung by a mention, but never count as one of the two agents or in the all done close.',
    ),
  room: roomField.describe('Room to join. It is made on first join.'),
  seat_token: z
    .string()
    .regex(SEAT_TOKEN_PATTERN, 'a seat token from an earlier join')
    .optional()
    .describe('The seat token an earlier join gave you, so you get your seat back with its role.'),
  thread_id: z
    .string()
    .min(1)
    .optional()
    .describe('For Codex: the value of $CODEX_THREAD_ID, so messhall can ring this session.'),
  topic: topicField
    .optional()
    .describe('What the room is for, one line, at most 200 chars. Only counts when this join makes the room.'),
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

export const assignRoleInputSchema = z.object({
  instructions: z
    .string()
    .min(1)
    .max(INSTRUCTIONS_MAX_CHARS)
    .optional()
    .describe('What the member should do in this role, at most 4,000 chars. It replaces any earlier ones.'),
  member: nameSchema.describe('Name of the member to give the role.'),
  role: roleSchema.describe('The role: worker, reviewer, orchestrator, observer or any short slug.'),
  room: roomField.describe('Room you joined, where the member sits.'),
});

export const kickInputSchema = z.object({
  member: nameSchema.describe('Name of the member to remove.'),
  room: roomField.describe('Room you joined, where the member sits.'),
});

export const muteInputSchema = z.object({
  member: nameSchema.describe('Name of the member to mute or unmute.'),
  room: roomField.describe('Room you joined, where the member sits.'),
  unmute: z.boolean().optional().describe('True lifts the mute. Left out, the member is muted.'),
});

export const setTopicInputSchema = z.object({
  room: roomField.describe('Room you joined.'),
  topic: topicField.describe('What the room is for, one line, at most 200 chars. It replaces the old topic.'),
});

export const setStatusInputSchema = z.object({
  room: roomField.describe('Room you joined.'),
  status: oneLine(STATUS_MAX_CHARS).describe(
    'What you are doing now, one line, at most 80 chars, like tests green or waiting on review. Empty clears it.',
  ),
});

export const myRoleInputSchema = z.object({
  room: roomField.describe('Room you joined.'),
});

// A label lands in a human line, so it holds no @ that could ring or name anyone.
const optionField = oneLine(OPTION_MAX_CHARS)
  .trim()
  .min(1)
  .regex(/^[^@]*$/, 'no @');

export const askHumanInputSchema = z.object({
  options: z
    .array(optionField)
    .min(OPTIONS_MIN)
    .max(OPTIONS_MAX)
    .describe('2 to 4 button labels, at most 40 chars each, one line, no @. Like ["ship it", "wait for review"].'),
  question: z.string().trim().min(1).max(QUESTION_MAX_CHARS).describe('What you ask the human, at most 500 chars.'),
  room: roomField.describe('Room you joined.'),
});

const agreementText = oneLine(AGREEMENT_MAX_CHARS).trim().min(1);
const agreementId = z.number().int().positive();

export const proposeInputSchema = z.object({
  replaces: agreementId
    .optional()
    .describe('Id of an open or settled agreement this one replaces. It is marked replaced.'),
  room: roomField.describe('Room you joined.'),
  text: agreementText.describe(
    'What you propose to agree, one line, at most 300 chars. Like "amount_minor is integer cents, api ships first".',
  ),
  with: z
    .array(nameSchema)
    .min(1)
    .max(AGREEMENT_WITH_MAX)
    .describe('The agents in the room who must confirm it, 1 to 8 names, not you.'),
});

export const confirmInputSchema = z.object({
  id: agreementId.describe('Id of the agreement to confirm, the id of its proposal line.'),
  room: roomField.describe('Room you joined.'),
});

export const rejectInputSchema = z.object({
  id: agreementId.describe('Id of the agreement to reject, the id of its proposal line.'),
  room: roomField.describe('Room you joined.'),
  why: agreementText.describe('Why you say no, one line, at most 300 chars. Propose what you would take instead.'),
});

export const agreementsInputSchema = z.object({
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
export type AssignRoleInput = z.infer<typeof assignRoleInputSchema>;
export type KickInput = z.infer<typeof kickInputSchema>;
export type MuteInput = z.infer<typeof muteInputSchema>;
export type SetTopicInput = z.infer<typeof setTopicInputSchema>;
export type SetStatusInput = z.infer<typeof setStatusInputSchema>;
export type MyRoleInput = z.infer<typeof myRoleInputSchema>;
export type ProposeInput = z.infer<typeof proposeInputSchema>;
export type ConfirmInput = z.infer<typeof confirmInputSchema>;
export type RejectInput = z.infer<typeof rejectInputSchema>;
export type LeaveInput = z.infer<typeof leaveInputSchema>;
