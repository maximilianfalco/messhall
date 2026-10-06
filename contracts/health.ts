import { z } from 'zod';

export const healthSchema = z.object({
  live_members: z.number().int().nonnegative().describe('Agents in a room right now that are not gone.'),
  ok: z.literal(true).describe('Always true when the daemon answers.'),
  rooms: z.number().int().nonnegative().describe('Rooms the daemon holds, open or closed.'),
  uptime_s: z.number().int().nonnegative().describe('Whole seconds since the daemon started.'),
  version: z.string().describe('The messhall version the daemon runs.'),
});

export type Health = z.infer<typeof healthSchema>;
