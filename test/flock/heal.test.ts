import type { HealSeat, Watch } from '../../src/flock/heal.js';

import { describe, expect, it } from 'vitest';

import { HEAL_BACKOFF_MS, HEAL_RESET_MS, HEAL_TRIES } from '../../src/config.js';
import { healPlan } from '../../src/flock/heal.js';

const SESSION = 'messhall_demo_api';
const FRESH: Watch = { gaveUp: false, lastAt: null, tries: 0 };

const seat = (overrides: Partial<HealSeat> = {}): HealSeat => ({
  agent: 'claude',
  alive: false,
  closed: false,
  done: false,
  held: false,
  name: 'api',
  presence: 'away',
  room: 'demo',
  session: SESSION,
  ...overrides,
});

const plan = ({ now = 0, seats = [seat()], watch }: { now?: number; seats?: HealSeat[]; watch?: Watch }) =>
  healPlan({ now, seats, watches: new Map(watch ? [[SESSION, watch]] : []) });

const actionOf = (input: Parameters<typeof plan>[0]) => plan(input).steps[0]?.action;

describe('healPlan', () => {
  it('starts watching a seat the first time its session runs', () => {
    const next = plan({ seats: [seat({ alive: true, presence: 'active' })] });

    expect(next.steps).toStrictEqual([]);
    expect(next.watches.get(SESSION)).toStrictEqual(FRESH);
  });

  it('never restarts a seat it never saw running', () => {
    expect(plan({}).steps).toStrictEqual([]);
  });

  it('restarts a watched seat whose session is gone, counting the try', () => {
    const next = plan({ now: 5000, watch: FRESH });

    expect(next.steps).toStrictEqual([{ action: 'restart', seat: seat(), try: 1 }]);
    expect(next.watches.get(SESSION)).toStrictEqual({ gaveUp: false, lastAt: 5000, tries: 1 });
  });

  it('waits while an mcp session still holds the seat', () => {
    expect(actionOf({ seats: [seat({ held: true })], watch: FRESH })).toBeUndefined();
  });

  it.each([
    ['done', { done: true }],
    ['still invited', { presence: 'invited' as const }],
    ['a codex', { agent: 'codex' as const }],
    ['in a closed room', { closed: true }],
  ])('leaves a seat that is %s alone', (_label, overrides) => {
    expect(actionOf({ seats: [seat(overrides)], watch: FRESH })).toBeUndefined();
  });

  it('backs off longer after each try', () => {
    const afterOne = { gaveUp: false, lastAt: 0, tries: 1 };
    const afterTwo = { gaveUp: false, lastAt: 0, tries: 2 };

    expect(actionOf({ now: HEAL_BACKOFF_MS - 1, watch: afterOne })).toBeUndefined();
    expect(actionOf({ now: HEAL_BACKOFF_MS, watch: afterOne })).toBe('restart');
    expect(actionOf({ now: 2 * HEAL_BACKOFF_MS - 1, watch: afterTwo })).toBeUndefined();
    expect(actionOf({ now: 2 * HEAL_BACKOFF_MS, watch: afterTwo })).toBe('restart');
  });

  it(`gives up once after ${HEAL_TRIES} tries and then stays quiet`, () => {
    const spent = { gaveUp: false, lastAt: 0, tries: HEAL_TRIES };

    const next = plan({ now: HEAL_RESET_MS, watch: spent });
    const after = healPlan({ now: 2 * HEAL_RESET_MS, seats: [seat()], watches: next.watches });

    expect(next.steps).toStrictEqual([{ action: 'give_up', seat: seat(), try: HEAL_TRIES }]);
    expect(after.steps).toStrictEqual([]);
  });

  it('keeps the tries of a seat that came back only a short while ago', () => {
    const recent = { gaveUp: false, lastAt: 0, tries: 2 };

    const next = plan({ now: HEAL_RESET_MS - 1, seats: [seat({ alive: true })], watch: recent });

    expect(next.watches.get(SESSION)).toStrictEqual(recent);
  });

  it('forgets the tries of a seat that stayed up long enough', () => {
    const old = { gaveUp: true, lastAt: 0, tries: HEAL_TRIES };

    const next = plan({ now: HEAL_RESET_MS, seats: [seat({ alive: true })], watch: old });

    expect(next.watches.get(SESSION)).toStrictEqual(FRESH);
  });

  it('drops the watch of a seat that left or was kicked, so it never restarts', () => {
    const next = plan({ seats: [], watch: FRESH });

    expect(next.watches.size).toBe(0);
    expect(next.steps).toStrictEqual([]);
  });

  it('never changes the watches it was given', () => {
    const watches = new Map([[SESSION, FRESH]]);

    healPlan({ now: 0, seats: [seat()], watches });

    expect(watches).toStrictEqual(new Map([[SESSION, FRESH]]));
  });
});
