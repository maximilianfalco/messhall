import { z } from 'zod';

export const PRESENCES = ['invited', 'active', 'waiting', 'idle', 'away', 'left'] as const;
export const MESSAGE_KINDS = ['chat', 'system', 'done', 'summary'] as const;
export const MEMBER_KINDS = ['claude', 'codex', 'other', 'human'] as const;
export const LAUNCH_AGENTS = ['claude', 'codex'] as const;

export const NAME_PATTERN = /^[a-z0-9-]{1,40}$/;
// A model name goes into the agent's argv, so it starts with a letter or digit and can never read as a flag.
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9.[\]-]{0,63}$/i;
export const TEXT_MAX_CHARS = 4000;
export const INSTRUCTIONS_MAX_CHARS = 4000;
export const STATUS_MAX_CHARS = 80;
export const HUMAN_NAME = 'human';
export const SYSTEM_NAME = 'messhall';
export const ALL_MENTION = 'all';
// The usual roles. Any short slug works too, so a room can name its own.
export const ROLES = ['unassigned', 'worker', 'reviewer', 'orchestrator', 'observer'] as const;
export const UNASSIGNED_ROLE = 'unassigned';
export const ORCHESTRATOR_ROLE = 'orchestrator';
export const OBSERVER_ROLE = 'observer';
export const REVIEWER_ROLE = 'reviewer';
// The human seat, daemon lines and @all would be forged or ambiguous if an agent could hold these.
export const RESERVED_NAMES = [HUMAN_NAME, SYSTEM_NAME, ALL_MENTION] as const;

export type Presence = (typeof PRESENCES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MemberKind = (typeof MEMBER_KINDS)[number];
export type AgentKind = Exclude<MemberKind, 'human'>;
export type Launch = z.infer<typeof launchSchema>;

export const nameSchema = z
  .string()
  .regex(NAME_PATTERN)
  .describe('Lowercase letters, digits and dashes, 1 to 40 chars.');
export const timestampSchema = z.iso.datetime().describe('ISO 8601 time in UTC.');
export const presenceSchema = z
  .enum(PRESENCES)
  .describe(
    'What the member is doing: invited (a seat made ahead, its agent has not come yet), active, waiting, idle, away (its session dropped or went quiet, the seat is kept) or left (called leave).',
  );
export const messageKindSchema = z
  .enum(MESSAGE_KINDS)
  .describe(
    'chat from a member, system from the daemon, done when a member is finished, summary of the room so far from the daemon.',
  );
export const memberKindSchema = z
  .enum(MEMBER_KINDS)
  .describe('Which agent runs the member: claude, codex, other or human.');

export const roomSchema = z.object({
  closed_at: timestampSchema.nullable().describe('When the room closed, null while it is open.'),
  created_at: timestampSchema.describe('When the room was made.'),
  created_by: z.string().describe('Who made the room: human, or the name of the agent whose join made it.'),
  id: z.string().describe('Room id.'),
  name: nameSchema.describe('Room name, unique.'),
  standing: z
    .boolean()
    .describe('True for a room the human made. It stays open when every agent is done, until the human closes it.'),
  topic: z.string().nullable().describe('What the room is for, null when unset.'),
});

export const roleSchema = z
  .string()
  .regex(NAME_PATTERN)
  .describe(`What the member does here, like ${ROLES.join(', ')}. Any short slug works.`);

export const launchSchema = z.object({
  agent: z.enum(LAUNCH_AGENTS).describe('Which agent to start: claude or codex.'),
  brief: z.string().optional().describe('Path to a brief the agent reads first.'),
  cwd: z.string().min(1).describe('Folder the agent starts in.'),
  model: z
    .string()
    .regex(MODEL_PATTERN)
    .optional()
    .describe('Model the agent runs on, like opus or claude-opus-5-5, its default when left out.'),
});

export const memberSchema = z.object({
  client_label: z
    .string()
    .nullable()
    .describe(
      'Short agent type from the client name, like claude or opencode, or its first word when unknown. Null for the human seat or a member with no client.',
    ),
  client_name: z
    .string()
    .nullable()
    .describe('The clientInfo.name the agent sent at initialize, as sent. Self-declared, null when none.'),
  client_version: z
    .string()
    .nullable()
    .describe('The clientInfo.version the agent sent at initialize, null when none.'),
  cursor: z.number().int().nonnegative().describe('Id of the last message this member has read.'),
  done: z.boolean().describe('True after the member posted done, until its next post.'),
  joined_at: timestampSchema.describe('When the member first joined.'),
  kind: memberKindSchema.describe('Which agent runs the member.'),
  last_seen_at: timestampSchema.describe('When the member last made a call.'),
  left_at: timestampSchema.nullable().describe('When the member left, null while it is in the room.'),
  muted: z
    .boolean()
    .describe('True while the human or an orchestrator has muted the member: it reads, but its posts are refused.'),
  name: nameSchema.describe('Role name in the room.'),
  presence: presenceSchema.describe('What the member is doing now.'),
  role: roleSchema.describe(
    'What the member does here. Starts unassigned, orchestrator for a member named orchestrator.',
  ),
  room_id: z.string().describe('Room id.'),
  status: z
    .string()
    .max(STATUS_MAX_CHARS)
    .nullable()
    .describe('What the member is doing now, one line it set itself, like tests green. Null when unset.'),
  status_at: timestampSchema.nullable().describe('When the member set its status, null when unset.'),
});

export const messageSchema = z.object({
  created_at: timestampSchema.describe('When it was posted.'),
  from: z.string().describe('Member name, or messhall for daemon lines.'),
  from_client_label: z
    .string()
    .nullable()
    .describe(
      "The sender's agent type when it posted, like claude or script. Null for the human, daemon lines or a sender with no client.",
    ),
  from_kind: memberKindSchema
    .nullable()
    .describe('Which agent ran the sender when it posted. Null for daemon lines and summaries.'),
  id: z.number().int().positive().describe('Global message id, one order across every room.'),
  kind: messageKindSchema.describe('Message kind.'),
  mentions: z.array(z.string()).describe('Member names mentioned with @, or all.'),
  room_id: z.string().describe('Room id.'),
  text: z.string().max(TEXT_MAX_CHARS).describe('Message text, at most 4,000 chars.'),
});

export const roomSummarySchema = roomSchema.extend({
  first_message_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('Id of the oldest message in the room, system lines too. Null while it has none.'),
  message_count: z.number().int().nonnegative().describe('Posts from members, not daemon lines or summaries.'),
});

export const APPROVAL_STATES = ['pending', 'allowed', 'denied', 'expired'] as const;
export const APPROVAL_BEHAVIORS = ['allow', 'deny'] as const;

export const approvalSchema = z.object({
  answered_at: timestampSchema.nullable().describe('When it was answered or expired, null while pending.'),
  created_at: timestampSchema.describe('When the agent asked.'),
  description: z.string().describe("The agent's own summary of the call. Untrusted text, never the command itself."),
  id: z.string().describe('Approval id. The human answers this exact id.'),
  input_preview: z.string().describe('The tool arguments as JSON shaped text, like the command for Bash. Untrusted.'),
  member: nameSchema.describe('The seat whose agent asks.'),
  room: nameSchema.describe('Room the seat is in.'),
  state: z
    .enum(APPROVAL_STATES)
    .describe('pending until the human answers, allowed or denied after, expired when nobody answered in time.'),
  tool: z.string().describe('The tool the agent wants to use, like Bash or Write.'),
});

export const QUESTION_STATES = ['open', 'answered', 'expired', 'replaced'] as const;
export const QUESTION_MAX_CHARS = 500;
export const OPTION_MAX_CHARS = 40;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 4;

export const questionSchema = z.object({
  answer: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe('Index of the option the human picked, from 0. Null until then.'),
  answered_at: timestampSchema.nullable().describe('When it was answered, expired or replaced, null while open.'),
  created_at: timestampSchema.describe('When the agent asked.'),
  id: z.string().describe('Question id. The human answers this exact id.'),
  member: nameSchema.describe('The seat whose agent asks.'),
  message_id: z.number().int().positive().describe("The asker's own line in the room that carries the question."),
  options: z.array(z.string()).describe('The button labels, 2 to 4, in order. Untrusted text from the agent.'),
  question: z.string().describe('What the agent asks the human. Untrusted text from the agent.'),
  room: nameSchema.describe('Room the question is in.'),
  state: z
    .enum(QUESTION_STATES)
    .describe(
      'open until the human answers, answered after, expired when nobody answered in time, replaced by a newer ask.',
    ),
});

export const AGREEMENT_STATES = ['open', 'settled', 'rejected', 'replaced'] as const;
export const AGREEMENT_MAX_CHARS = 300;
export const AGREEMENT_WITH_MAX = 8;

export const agreementSchema = z.object({
  confirmed: z.array(nameSchema).describe('The named members who confirmed so far, in the order they did.'),
  created_at: timestampSchema.describe('When it was proposed.'),
  decided_at: timestampSchema.nullable().describe('When it was settled, rejected or replaced, null while open.'),
  id: z.number().int().positive().describe("Agreement id: the id of the proposer's own line that carries it."),
  proposer: nameSchema.describe('The seat that proposed it.'),
  rejected_by: nameSchema.nullable().describe('Who rejected it, null unless rejected.'),
  replaces: z.number().int().positive().nullable().describe('The agreement this one replaces, null when new.'),
  room: nameSchema.describe('Room the agreement is in.'),
  state: z
    .enum(AGREEMENT_STATES)
    .describe(
      'open until every named member confirms, settled after, rejected when a named member says no, replaced by a newer proposal.',
    ),
  text: z.string().describe('What is agreed, one line. Untrusted text from the agent.'),
  why: z
    .string()
    .nullable()
    .describe('Why it was rejected, one line, null unless rejected. Untrusted text from the agent.'),
  with: z.array(nameSchema).describe('The members who must confirm it, in the order the proposer named them.'),
});

export type Room = z.infer<typeof roomSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Message = z.infer<typeof messageSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type ApprovalBehavior = (typeof APPROVAL_BEHAVIORS)[number];
export type Question = z.infer<typeof questionSchema>;
export type Agreement = z.infer<typeof agreementSchema>;
