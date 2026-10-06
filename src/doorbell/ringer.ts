import type { AgentKind } from '../../contracts/room.ts';

export interface RingInput {
  member: { name: string; rooms: string[] };
  meta: Record<string, string>;
  text: string;
}

/** Delivers a ring to the agent kinds it serves. Resolves to how many sessions it reached, never rejects. */
export interface Ringer {
  kinds: AgentKind[];
  ring(input: RingInput): Promise<number>;
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
