import type { Launch, Presence } from '../../contracts/room.ts';

import { HEAL_BACKOFF_MS, HEAL_RESET_MS, HEAL_TRIES } from '../config.js';

/** A spawned seat as the sweep sees it: whether its tmux session runs and whether an mcp session still holds it. */
export interface HealSeat {
  agent: Launch['agent'];
  alive: boolean;
  done: boolean;
  held: boolean;
  name: string;
  presence: Presence;
  room: string;
  session: string;
}

/** What the healer remembers of one seat: restarts so far, when the last one was, and whether it gave up. */
export interface Watch {
  gaveUp: boolean;
  lastAt: number | null;
  tries: number;
}

export interface HealStep {
  action: 'give_up' | 'restart';
  seat: HealSeat;
  try: number;
}

const FRESH: Watch = { gaveUp: false, lastAt: null, tries: 0 };

const backoffMs = (tries: number) => (tries ? HEAL_BACKOFF_MS * 2 ** (tries - 1) : 0);

// Only claude restarts on its own seat key. Codex keys its seat by a thread that dies with it.
const healable = (seat: HealSeat) => seat.agent === 'claude' && !seat.done && seat.presence !== 'invited' && !seat.held;

function stepFor({ now, seat, watch }: { now: number; seat: HealSeat; watch?: Watch }): [Watch | undefined, HealStep?] {
  if (seat.alive) {
    const settled = !watch || (watch.lastAt !== null && now - watch.lastAt >= HEAL_RESET_MS);
    return [settled ? FRESH : watch];
  }
  if (!watch || watch.gaveUp || !healable(seat)) return [watch];
  if (watch.tries >= HEAL_TRIES) {
    const step: HealStep = { action: 'give_up', seat, try: watch.tries };
    return [{ ...watch, gaveUp: true }, step];
  }
  if (watch.lastAt !== null && now - watch.lastAt < backoffMs(watch.tries)) return [watch];
  const tries = watch.tries + 1;
  const step: HealStep = { action: 'restart', seat, try: tries };
  return [{ ...watch, lastAt: now, tries }, step];
}

/** Which spawned seats to restart or give up on, plus the watches for the next sweep. Only a seat seen running is
 * watched, so a seat from before a reboot stays down. A seat missing from `seats` left, so its watch goes. */
export function healPlan({
  now,
  seats,
  watches,
}: {
  now: number;
  seats: HealSeat[];
  watches: ReadonlyMap<string, Watch>;
}) {
  const next = new Map<string, Watch>();
  const steps = seats.flatMap(seat => {
    const [watch, step] = stepFor({ now, seat, watch: watches.get(seat.session) });
    if (watch) next.set(seat.session, watch);
    return step ? [step] : [];
  });
  return { steps, watches: next };
}

/** The room line for one restart. */
export const restartLine = ({ name, try: n }: { name: string; try: number }) =>
  `${name} stopped, messhall is starting it again (try ${n} of ${HEAL_TRIES})`;

/** The room line once restarts run out. It names the human, since only the human can look at why. */
export const keepsDyingLine = ({ name, room }: { name: string; room: string }) =>
  `@human ${name} keeps dying in #${room}, messhall stopped restarting it. start it again or kick it`;
