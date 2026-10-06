import type { BusEvent, SequencedEvent } from '../../contracts/events.ts';
import type { DatabaseSync } from 'node:sqlite';

import { sequencedEventSchema } from '../../contracts/events.ts';
import { EVENT_KEEP_MS } from '../config.js';
import { parseStoredJson } from '../lib/json.js';
import { logger } from '../lib/logger.js';

export type EventListener = (event: SequencedEvent) => void;

/** Writes each event to the events table, then hands it to listeners with its global sequence. */
export function createEventBus({ db, now }: { db: DatabaseSync; now: () => Date }) {
  const listeners = new Set<EventListener>();
  const insert = db.prepare('INSERT INTO events (kind, payload, created_at) VALUES (?, ?, ?) RETURNING seq');
  const prune = db.prepare('DELETE FROM events WHERE created_at < ?');
  const after = db.prepare('SELECT seq, payload, created_at FROM events WHERE seq > ? ORDER BY seq');

  return {
    /** Stores the event, drops events older than 7 days, and calls every listener. */
    emit(event: BusEvent) {
      const at = now();
      prune.run(new Date(at.getTime() - EVENT_KEEP_MS).toISOString());
      const row = insert.get(event.type, JSON.stringify(event), at.toISOString());
      const sequenced: SequencedEvent = { created_at: at.toISOString(), event, seq: Number(row?.seq) };
      listeners.forEach(listener => {
        // One bad listener must not undo a write that already landed.
        try {
          listener(sequenced);
        } catch (error) {
          logger.error(error instanceof Error ? error : new Error(String(error)), {
            message: 'event listener failed',
            seq: sequenced.seq,
          });
        }
      });
      return sequenced;
    },
    /** Calls `listener` for every new event. Returns a function that stops it. */
    on(listener: EventListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Every kept event after `seq`, oldest first. */
    since(seq: number) {
      return after.all(seq).map(row =>
        sequencedEventSchema.parse({
          created_at: row.created_at,
          event: parseStoredJson(String(row.payload)),
          seq: row.seq,
        }),
      );
    },
  };
}
