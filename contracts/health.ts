import { z } from 'zod';

export const buildSchema = z.object({
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .describe('The git commit the code was built from, 40 hex chars.'),
  committed_at: z.iso.datetime().describe('When that commit was made, ISO 8601 in UTC. Later means newer code.'),
});

export const healthSchema = z.object({
  build: buildSchema
    .nullable()
    .optional()
    .describe(
      'The code the daemon started on, null when it is not a git checkout. Missing means a daemon too old to say.',
    ),
  contract_version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('The feed contract the daemon speaks. Missing means a daemon too old to say.'),
  live_members: z.number().int().nonnegative().describe('Agents in a room right now that are not away.'),
  ok: z.literal(true).describe('Always true when the daemon answers.'),
  rooms: z.number().int().nonnegative().describe('Rooms the daemon holds, open or closed.'),
  uptime_s: z.number().int().nonnegative().describe('Whole seconds since the daemon started.'),
  version: z.string().describe('The messhall version the daemon runs.'),
});

export type Build = z.infer<typeof buildSchema>;
export type Health = z.infer<typeof healthSchema>;
