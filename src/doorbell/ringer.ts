import type { AgentKind } from '../../contracts/room.ts';

export interface RingInput {
  member: { name: string; rooms: string[] };
  meta: Record<string, string>;
  text: string;
}

/** How many sessions a ring reached, and how many of those never answered their doorbell check. */
export interface RingResult {
  sessions: number;
  unconfirmed: number;
}

/** Delivers a ring to the agent kinds it serves. Never rejects. */
export interface Ringer {
  kinds: AgentKind[];
  ring(input: RingInput): Promise<RingResult>;
}

/** The ringers by agent kind. A kind with no ringer is never rung and falls back to wait. */
export function createRingers(ringers: Ringer[]) {
  const byKind = new Map(ringers.flatMap(ringer => ringer.kinds.map(kind => [kind, ringer] as const)));
  return {
    /** The ringer for `kind`, if one is set. */
    for(kind: string) {
      return byKind.get(kind as AgentKind);
    },
  };
}

export type Ringers = ReturnType<typeof createRingers>;
