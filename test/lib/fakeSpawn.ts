import type { ClaudeSpawn } from '../../src/lib/claude.js';

import { EventEmitter } from 'node:events';

type Outcome = { code: number; stderr?: string; stdout?: string } | { error: NodeJS.ErrnoException } | { hang: true };

interface FakeCall {
  args: string[];
  command: string;
}

class FakeChild extends EventEmitter {
  killed = false;
  stderr = new EventEmitter();
  stdout = new EventEmitter();

  kill() {
    this.killed = true;
    this.emit('close', null);
    return true;
  }
}

/** A spawn that plays one outcome per call, the last one again once they run out. */
export function fakeSpawn(outcomes: Outcome[]) {
  const calls: FakeCall[] = [];
  const children: FakeChild[] = [];
  const spawn: ClaudeSpawn = (command, args) => {
    calls.push({ args, command });
    const outcome = outcomes[calls.length - 1] ?? outcomes.at(-1)!;
    const child = new FakeChild();
    children.push(child);
    queueMicrotask(() => {
      if ('error' in outcome) {
        child.emit('error', outcome.error);
        return;
      }
      if ('hang' in outcome) return;
      if (outcome.stdout) child.stdout.emit('data', Buffer.from(outcome.stdout));
      if (outcome.stderr) child.stderr.emit('data', Buffer.from(outcome.stderr));
      child.emit('close', outcome.code);
    });
    return child;
  };
  return { calls, children, spawn };
}

export const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });

export const envelope = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    duration_ms: 3690,
    is_error: false,
    modelUsage: { 'claude-haiku-4-5-20251001': { costUSD: 0.0008 } },
    result: 'pong',
    session_id: 'sess-1',
    subtype: 'success',
    total_cost_usd: 0.0008,
    type: 'result',
    usage: { cache_creation_input_tokens: 7, cache_read_input_tokens: 10, input_tokens: 386, output_tokens: 4 },
    ...overrides,
  });
