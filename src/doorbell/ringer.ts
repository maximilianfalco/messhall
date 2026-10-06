import type { AgentKind } from '../../contracts/room.ts';

export interface RingInput {
  member: { name: string; rooms: string[] };
  meta: Record<string, string>;
  text: string;
}

/** Delivers a ring to one agent kind. Resolves to how many sessions it reached, never rejects. */
export interface Ringer {
  kind: AgentKind;
  ring(input: RingInput): Promise<number>;
}

/** The ringers by agent kind. A kind with no ringer is never rung and falls back to wait. */
export function createRingers(ringers: Ringer[]) {
  const byKind = new Map(ringers.map(ringer => [ringer.kind, ringer]));
  return {
    /** The ringer for `kind`, if one is set. */
    for(kind: string) {
      return byKind.get(kind as AgentKind);
    },
  };
}

export type Ringers = ReturnType<typeof createRingers>;
