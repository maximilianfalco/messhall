import { z } from 'zod';

export const PRESENCES = ['active', 'waiting', 'idle', 'gone'] as const;
export const MESSAGE_KINDS = ['chat', 'system', 'done'] as const;
export const MEMBER_KINDS = ['claude', 'codex', 'other', 'human'] as const;

export const NAME_PATTERN = /^[a-z0-9-]{1,40}$/;
export const TEXT_MAX_CHARS = 4000;
export const HUMAN_NAME = 'human';
export const SYSTEM_NAME = 'messhall';
export const ALL_MENTION = 'all';
// The human seat, daemon lines and @all would be forged or ambiguous if an agent could hold these.
export const RESERVED_NAMES = [HUMAN_NAME, SYSTEM_NAME, ALL_MENTION] as const;

export type Presence = (typeof PRESENCES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MemberKind = (typeof MEMBER_KINDS)[number];
export type AgentKind = Exclude<MemberKind, 'human'>;

export const nameSchema = z
  .string()
  .regex(NAME_PATTERN)
  .describe('Lowercase letters, digits and dashes, 1 to 40 chars.');
export const timestampSchema = z.iso.datetime().describe('ISO 8601 time in UTC.');
export const presenceSchema = z.enum(PRESENCES).describe('What the member is doing: active, waiting, idle or gone.');
export const messageKindSchema = z
  .enum(MESSAGE_KINDS)
  .describe('chat from a member, system from the daemon, done when a member is finished.');
export const memberKindSchema = z
  .enum(MEMBER_KINDS)
  .describe('Which agent runs the member: claude, codex, other or human.');

export const roomSchema = z.object({
  closed_at: timestampSchema.nullable().describe('When the room closed, null while it is open.'),
  created_at: timestampSchema.describe('When the room was made.'),
  created_by: z.string().describe('Who made the room: human, or the name of the agent whose join made it.'),
  id: z.string().describe('Room id.'),
  message_cap: z.number().int().positive().describe('Posts allowed before the room closes.'),
  name: nameSchema.describe('Room name, unique.'),
  standing: z
    .boolean()
    .describe(
      'True for a room the human made. It stays open when every agent is done, until its cap or the human closes it.',
    ),
  topic: z.string().nullable().describe('What the room is for, null when unset.'),
});

export const memberSchema = z.object({
  cursor: z.number().int().nonnegative().describe('Id of the last message this member has read.'),
  done: z.boolean().describe('True after the member posted done, until its next post.'),
  joined_at: timestampSchema.describe('When the member first joined.'),
  kind: memberKindSchema.describe('Which agent runs the member.'),
  last_seen_at: timestampSchema.describe('When the member last made a call.'),
  left_at: timestampSchema.nullable().describe('When the member left, null while it is in the room.'),
  name: nameSchema.describe('Role name in the room.'),
  presence: presenceSchema.describe('What the member is doing now.'),
  room_id: z.string().describe('Room id.'),
});

export const messageSchema = z.object({
  created_at: timestampSchema.describe('When it was posted.'),
  from: z.string().describe('Member name, or messhall for daemon lines.'),
  id: z.number().int().positive().describe('Global message id, one order across every room.'),
  kind: messageKindSchema.describe('Message kind.'),
  mentions: z.array(z.string()).describe('Member names mentioned with @, or all.'),
  room_id: z.string().describe('Room id.'),
  text: z.string().max(TEXT_MAX_CHARS).describe('Message text, at most 4,000 chars.'),
});

export const roomSummarySchema = roomSchema.extend({
  message_count: z.number().int().nonnegative().describe('Posts that count toward the cap.'),
});

export type Room = z.infer<typeof roomSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Message = z.infer<typeof messageSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
