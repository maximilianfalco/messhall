import type { AgentKind } from '../../contracts/room.ts';
import type { CodexClient } from '../codex/client.js';
import type { Tmux } from '../flock/tmux.js';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { queueText } from '../codex/client.js';
import { SPAWN_DIR } from '../flock/spawner.js';
import { tmux as runTmux, typeIfClear } from '../flock/tmux.js';
import { logger } from '../lib/logger.js';
import { SEAT_HEADER, SERVER_NAME } from '../mcp/constants.js';

// With no utf-8 locale, as under launchd, tmux prints a tab as `_`. A session name never holds `:`, so it splits safely.
const PANE_FORMAT = '#{session_name}:#{pane_start_command}';
const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

export interface WakeSeat {
  kind: AgentKind;
  name: string;
  room: string;
  seatKey: string | null;
}

export interface WakeTarget {
  channel: 'codex' | 'tmux';
  names: string[];
  rooms: string[];
  target: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The seat key in a spawned agent's mcp config, if the file holds one. */
function seatKeyIn(file: string): string | undefined {
  try {
    const seat: unknown = JSON.parse(readFileSync(file, 'utf8')).mcpServers?.[SERVER_NAME]?.headers?.[SEAT_HEADER];
    if (typeof seat === 'string') return seat;
  } catch {
    // A config gone or half written holds no key.
  }
}

/** Seat key to tmux session, for each pane whose start command loads an mcp config from this daemon's spawn dir.
 * Both spawners write one there, so a scratch daemon never finds the real daemon's panes. */
export function tmuxSeats({
  listing,
  readSeatKey = seatKeyIn,
  spawnDir,
}: {
  listing: string;
  readSeatKey?: (file: string) => string | undefined;
  spawnDir: string;
}) {
  const config = new RegExp(`${escapeRegExp(spawnDir)}/[\\w.-]+-mcp\\.json`);
  return new Map(
    listing.split('\n').flatMap(line => {
      const cut = line.indexOf(':');
      const [session, command] = [line.slice(0, cut), line.slice(cut + 1)];
      const file = config.exec(command)?.[0];
      const key = file && readSeatKey(file);
      return key ? [[key, session] as const] : [];
    }),
  );
}

/** Who to wake and how, one target per seat key: a claude through its tmux session, a codex through its thread.
 * Codex sends no seat header, so its seat key is its thread id. Anyone else has no way in and waits for its next call. */
export function wakeList({ seats, tmux }: { seats: WakeSeat[]; tmux: Map<string, string> }) {
  const bySeat = Map.groupBy(
    seats.filter(seat => seat.seatKey !== null),
    seat => seat.seatKey!,
  );
  return [...bySeat].flatMap(([key, held]): WakeTarget[] => {
    const kind = held[0]!.kind;
    const session = tmux.get(key);
    const reach = kind === 'claude' && session ? { channel: 'tmux' as const, target: session } : undefined;
    const thread = kind === 'codex' ? { channel: 'codex' as const, target: key } : undefined;
    const how = reach ?? thread;
    if (!how) return [];
    return [{ ...how, names: [...new Set(held.map(seat => seat.name))], rooms: held.map(seat => seat.room) }];
  });
}

/** The line a woken agent gets, naming each room it sits in. */
export const wakeText = (rooms: string[]) =>
  `messhall restarted. call read_since on ${LIST.format(rooms.map(room => `#${room}`))}, then carry on with your work.`;

/** Wakes every seat it can reach after a restart: types the wake line into a spawned claude's tmux pane, or
 * queues it on a codex thread. A codex thread that is not loaded is a closed TUI, so it is skipped quietly. A pane showing a menu or a draft is left alone. Never rejects. */
export async function wakeSeats({
  codex,
  dataDir,
  seats,
  settleMs,
  tmux = runTmux,
}: {
  codex: Pick<CodexClient, 'request'>;
  dataDir: string;
  seats: WakeSeat[];
  settleMs?: number;
  tmux?: Tmux;
}) {
  const listed = await tmux(['list-panes', '-a', '-F', PANE_FORMAT]);
  if (listed.code !== 0) logger.info('wake found no tmux panes', { error: listed.stderr.trim() });
  const listing = listed.stdout;
  const sessions = tmuxSeats({ listing, spawnDir: path.join(dataDir, SPAWN_DIR) });
  const wake = async ({ channel, rooms, target }: WakeTarget) => {
    const text = wakeText(rooms);
    if (channel === 'codex') {
      const read = await codex.request('thread/read', { threadId: target });
      if (!read.ok || read.result.thread.status.type === 'notLoaded') return 'unloaded';
      const added = await queueText(codex, { text, threadId: target });
      return added.ok ? 'sent' : 'failed';
    }
    // A bare name falls back to a prefix match, which would hit another seat's session.
    return typeIfClear(`=${target}:`, text, { run: tmux, settleMs });
  };
  const woken = await Promise.all(
    wakeList({ seats, tmux: sessions }).map(async target => ({
      channel: target.channel,
      names: target.names,
      outcome: await wake(target),
      target: target.target,
    })),
  );
  return woken.filter(target => target.outcome !== 'unloaded');
}
