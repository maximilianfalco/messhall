import { z } from 'zod';

import { buildSchema } from './health.ts';
import {
  agreementSchema,
  APPROVAL_BEHAVIORS,
  approvalSchema,
  INSTRUCTIONS_MAX_CHARS,
  launchSchema,
  memberSchema,
  messageSchema,
  nameSchema,
  OPTIONS_MAX,
  OTHER_MAX_CHARS,
  questionSchema,
  QUESTIONS_MAX,
  roleSchema,
  roomSchema,
  roomSummarySchema,
  TEXT_MAX_CHARS,
} from './room.ts';

export const TOPIC_MAX_CHARS = 200;

export const SNAPSHOT_EVENT = 'snapshot';
// Bump when a feed enum or event type grows, so an older app can tell it is behind.
export const FEED_CONTRACT_VERSION = 8;

export const snapshotRoomSchema = roomSummarySchema.extend({
  agreements: z.array(agreementSchema).describe('Agreements still open and settled ones, oldest first.'),
  approvals: z.array(approvalSchema).describe('Tool asks still waiting for the human, oldest first.'),
  members: z.array(memberSchema).describe('Members still in the room, by name, the human seat too.'),
  messages: z.array(messageSchema).describe('The last 50 messages, oldest first, system lines too.'),
  questions: z.array(questionSchema).describe('Questions from agents still waiting for the human, oldest first.'),
  settled_questions: z
    .array(questionSchema)
    .describe('Questions answered, replaced or expired, oldest first, so each asking line shows how it ended.'),
});

export const snapshotSchema = z.object({
  build: buildSchema.nullable().describe('The code the daemon started on, null when it is not a git checkout.'),
  contract_version: z
    .number()
    .int()
    .positive()
    .meta({ 'x-current': FEED_CONTRACT_VERSION })
    .describe('The feed contract the daemon speaks. An app built for a lower number is older than the daemon.'),
  rooms: z.array(snapshotRoomSchema).describe('Every room, open or closed, by name.'),
  seq: z
    .number()
    .int()
    .nonnegative()
    .describe('The event sequence this snapshot is current to. Resume the feed after it.'),
  version: z.string().describe('The messhall version the daemon runs, for display.'),
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
  room: roomSchema.describe('The room, open again.'),
});

export const reviewNudgesResultSchema = z.object({
  review_nudges: z.boolean().describe('True when a review request quiet 15 minutes goes to another reviewer.'),
});

export const newRoomSchema = z.object({
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

export const humanSpawnSchema = z.object({
  agent: launchSchema.shape.agent.default('claude'),
  cwd: z.string().min(1).describe('Full path of the folder the agent starts in. It must exist.'),
  instructions: humanRoleSchema.shape.instructions,
  model: launchSchema.shape.model,
  name: nameSchema.describe('Name of the new seat in the room.'),
  role: roleSchema.describe('The role the agent holds from its first call.'),
});

export const spawnResultSchema = z.object({
  member: memberSchema.describe('The seat its agent now sits in.'),
  session: z.string().describe('The detached tmux session the agent runs in.'),
});

export const flockSeatSchema = z.object({
  agent: launchSchema.shape.agent,
  cwd: z.string().describe('Folder the agent started in.'),
  name: nameSchema.describe('The seat name.'),
  pid: z.number().int().nullable().describe('Pid of the shell in the tmux pane, null when the session is gone.'),
  presence: memberSchema.shape.presence,
  process: z.enum(['running', 'gone']).describe('Whether the tmux session still runs the agent.'),
  role: roleSchema.describe('The seat role.'),
  room: nameSchema.describe('The room the seat is in.'),
  session: z.string().describe('The tmux session name, to attach to.'),
});

export const flockSchema = z.object({
  seats: z.array(flockSeatSchema).describe('Every seat the spawner started, by room then name.'),
});

export const runningKindSchema = z.enum(['claude', 'codex']).describe('Which agent runs a session.');
export const runningReachSchema = z
  .enum(['claude_session', 'codex_thread', 'copy_only'])
  .describe(
    'How an invite reaches a session: claude session messaging, a line queued on its shared codex thread, or a copied line only.',
  );
export const runningStatusSchema = z.enum(['busy', 'idle', 'unknown']).describe('Whether a session is mid turn.');
export const inviteOutcomeSchema = z
  .enum(['queued', 'copy', 'gone'])
  .describe('queued: the line waits on its codex thread. copy: paste the line to it. gone: it stopped.');

export const runningSeatSchema = z.object({
  name: nameSchema.describe('The seat name.'),
  room: nameSchema.describe('The room the seat is in.'),
});

export const runningAgentSchema = z.object({
  branch: z.string().nullable().describe('Git branch of its folder, null outside a repo or on a detached head.'),
  cwd: z.string().describe('Folder the session runs in.'),
  id: z
    .string()
    .describe('Claude session id, codex thread id, or pid-<n> for a codex that only a copied join line reaches.'),
  kind: runningKindSchema,
  pid: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('Pid of its own process, null for a codex thread that only runs inside the shared codex server.'),
  reach: runningReachSchema,
  repo: z.string().nullable().describe('Name of the main checkout of its repo, null outside a repo.'),
  room: nameSchema.nullable().describe('A room it already sits in, null when none is known.'),
  seats: z.array(runningSeatSchema).describe('Every seat it holds, by room then name. Empty when it is not in a room.'),
  status: runningStatusSchema,
  tmux: z.string().nullable().describe('The tmux session of a spawned seat, null for one the human started.'),
});

export const roomSuggestionSchema = z.object({
  ids: z.array(z.string()).min(2).describe('Ids of the running agents that likely work on one thing.'),
  key: z.string().describe('What they share: a ticket key from the branch, or repo/branch.'),
  room: nameSchema.describe('The room name to suggest.'),
});

export const runningSchema = z.object({
  agents: z.array(runningAgentSchema).describe('Every claude and codex session running on this Mac.'),
  suggestions: z.array(roomSuggestionSchema).describe('Groups of them that may want a room together.'),
});

export const runningInviteSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe('Ids of the running agents to invite, from the running list.'),
  room: nameSchema.describe('The room to invite them to. Made as the human when missing, refused when closed.'),
});

export const runningInviteItemSchema = z.object({
  id: z.string().describe('The running agent id.'),
  line: z.string().nullable().describe('The join line it got, or the one to copy to it. Null when it is gone.'),
  name: nameSchema.nullable().describe('The name the line asks it to join as. Null when it is gone.'),
  outcome: inviteOutcomeSchema,
});

export const runningInviteResultSchema = z.object({
  invites: z.array(runningInviteItemSchema).describe('One result per id, in the order sent.'),
});

export const removeMemberResultSchema = z.object({
  member: memberSchema.describe('The member as it was when it was removed.'),
});

export const muteResultSchema = z.object({
  member: memberSchema.describe('The member after the mute or unmute.'),
});

export const humanApprovalSchema = z.object({
  behavior: z.enum(APPROVAL_BEHAVIORS).describe('allow lets the one tool call run, deny refuses it.'),
});

export const approvalResultSchema = z.object({
  approvals: z.array(approvalSchema).describe('The approval as answered, one per room its seat is in.'),
});

// Typed text lands in the human line, so it stays on one line like every other field in it.
const humanAnswerItemSchema = z.object({
  other: z
    .string()
    .trim()
    .min(1)
    .max(OTHER_MAX_CHARS)
    .regex(/^\P{Cc}*$/u, 'one line, no control characters')
    .optional()
    .describe('What the human typed in place of or next to a pick, one line, at most 300 chars.'),
  picks: z
    .array(z.number().int().nonnegative())
    .max(OPTIONS_MAX)
    .describe('Indexes of the picked options, from 0. Empty when the human only typed.'),
});

export const humanAnswerSchema = z.object({
  answers: z
    .array(humanAnswerItemSchema)
    .min(1)
    .max(QUESTIONS_MAX)
    .describe('One answer per question, in the order they were asked.'),
});

export const answerResultSchema = z.object({
  message: messageSchema.describe('The human line that carries the answer and rings the asker.'),
  question: questionSchema.describe('The question as answered.'),
});

export const feedErrorSchema = z.object({
  error: z.string().describe('What went wrong, in plain words.'),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type History = z.infer<typeof historySchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type HumanPostResult = z.infer<typeof humanPostResultSchema>;
export type ReopenResult = z.infer<typeof reopenResultSchema>;
export type ReviewNudgesResult = z.infer<typeof reviewNudgesResultSchema>;
export type NewRoomResult = z.infer<typeof newRoomResultSchema>;
export type CloseResult = z.infer<typeof closeResultSchema>;
export type HumanRole = z.infer<typeof humanRoleSchema>;
export type HumanRoleResult = z.infer<typeof humanRoleResultSchema>;
export type HumanSpawn = z.infer<typeof humanSpawnSchema>;
export type SpawnResult = z.infer<typeof spawnResultSchema>;
export type FlockSeat = z.infer<typeof flockSeatSchema>;
export type Flock = z.infer<typeof flockSchema>;
export type RunningSeat = z.infer<typeof runningSeatSchema>;
export type RunningAgent = z.infer<typeof runningAgentSchema>;
export type RoomSuggestion = z.infer<typeof roomSuggestionSchema>;
export type Running = z.infer<typeof runningSchema>;
export type RunningInvite = z.infer<typeof runningInviteSchema>;
export type RunningInviteItem = z.infer<typeof runningInviteItemSchema>;
export type RunningInviteResult = z.infer<typeof runningInviteResultSchema>;
export type RemoveMemberResult = z.infer<typeof removeMemberResultSchema>;
export type MuteResult = z.infer<typeof muteResultSchema>;
export type HumanApproval = z.infer<typeof humanApprovalSchema>;
export type ApprovalResult = z.infer<typeof approvalResultSchema>;
export type HumanAnswer = z.infer<typeof humanAnswerSchema>;
export type AnswerResult = z.infer<typeof answerResultSchema>;
