import { z } from 'zod';

import {
  APPROVAL_BEHAVIORS,
  approvalSchema,
  INSTRUCTIONS_MAX_CHARS,
  launchSchema,
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
// Bump when a feed enum or event type grows, so an older app can tell it is behind.
export const FEED_CONTRACT_VERSION = 2;

export const snapshotRoomSchema = roomSummarySchema.extend({
  approvals: z.array(approvalSchema).describe('Tool asks still waiting for the human, oldest first.'),
  members: z.array(memberSchema).describe('Members still in the room, by name, the human seat too.'),
  messages: z.array(messageSchema).describe('The last 50 messages, oldest first, system lines too.'),
});

export const snapshotSchema = z.object({
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
export type HumanSpawn = z.infer<typeof humanSpawnSchema>;
export type SpawnResult = z.infer<typeof spawnResultSchema>;
export type FlockSeat = z.infer<typeof flockSeatSchema>;
export type Flock = z.infer<typeof flockSchema>;
export type RemoveMemberResult = z.infer<typeof removeMemberResultSchema>;
export type MuteResult = z.infer<typeof muteResultSchema>;
export type HumanApproval = z.infer<typeof humanApprovalSchema>;
export type ApprovalResult = z.infer<typeof approvalResultSchema>;
