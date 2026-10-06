import type { Ask } from '../lib/claude.js';
import type { RoomStore } from './store.js';

import { TEXT_MAX_CHARS } from '../../contracts/room.ts';
import { SUMMARY_EVERY, SUMMARY_FIRST_AT, SUMMARY_TIMEOUT_MS } from '../config.js';
import { logger } from '../lib/logger.js';

import { summaryPrompt, SUMMARY_SYSTEM } from './prompts.js';

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/** True when a room with `count` posts needs a summary: first at 60, then 40 posts after the last one. */
export function summaryDue({ count, lastSummaryAt }: { count: number; lastSummaryAt: number | null }) {
  if (lastSummaryAt === null) return count >= SUMMARY_FIRST_AT;
  return count >= lastSummaryAt + SUMMARY_EVERY;
}

/** The prompt for the room's next summary, or why there is none. */
export function nextSummaryPrompt({ room, store }: { room: string; store: RoomStore }) {
  const state = store.summaryState(room);
  if (!state.ok) return state;
  const { messages, previous } = state;
  if (!messages.length) return { ok: false, reason: 'nothing_new' } as const;
  const prompt = summaryPrompt({ messages, previous, room, topic: state.room.topic });
  return { coversId: messages.at(-1)!.id, ok: true, posts: messages.length, prompt } as const;
}

/** Asks claude for the room's summary now and stores it. A claude failure is a result, never a throw. */
export async function summarizeRoom({ claude, room, store }: { claude: Ask; room: string; store: RoomStore }) {
  const next = nextSummaryPrompt({ room, store });
  if (!next.ok) return next;
  const { coversId, prompt } = next;
  const reply = await claude({ prompt, system: SUMMARY_SYSTEM, timeoutMs: SUMMARY_TIMEOUT_MS }).catch(
    (error: unknown) => asError(error),
  );
  if (reply instanceof Error) return { error: reply, ok: false, reason: 'claude_failed' } as const;
  const saved = store.addSummary({ coversId, room, text: reply.text.trim().slice(0, TEXT_MAX_CHARS) });
  if (!saved.ok) return saved;
  return { costUsd: reply.costUsd, durationMs: reply.durationMs, message: saved.message, ok: true, prompt } as const;
}

/**
 * Summarizes a room in the background once a post makes one due, one at a time per room.
 * A failure is logged once per room until a summary works again. Returns a function that stops it.
 */
export function startSummaries({ claude, store }: { claude: Ask; store: RoomStore }) {
  const running = new Set<string>();
  const failed = new Set<string>();

  async function run(room: string) {
    running.add(room);
    try {
      const result = await summarizeRoom({ claude, room, store });
      if (result.ok) {
        failed.delete(room);
        logger.info('room summarized', { chars: result.message.text.length, cost_usd: result.costUsd, room });
      } else if (result.reason === 'claude_failed' && !failed.has(room)) {
        failed.add(room);
        logger.error(result.error, { message: 'summary skipped', room });
      }
    } finally {
      running.delete(room);
    }
  }

  return store.events.on(({ event }) => {
    if (event.type !== 'message' || (event.message.kind !== 'chat' && event.message.kind !== 'done')) return;
    if (running.has(event.room)) return;
    const state = store.summaryState(event.room);
    if (!state.ok || !summaryDue(state)) return;
    run(event.room).catch((error: unknown) =>
      logger.error(asError(error), { message: 'summary failed', room: event.room }),
    );
  });
}
