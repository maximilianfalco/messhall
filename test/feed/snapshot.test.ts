import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FEED_SNAPSHOT_MESSAGES } from '../../src/config.js';
import { buildSnapshot } from '../../src/feed/snapshot.js';
import { scratchStore } from '../rooms/scratch.js';

let scratch: ReturnType<typeof scratchStore>;

beforeEach(() => {
  scratch = scratchStore();
  scratch.store.joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
  scratch.store.ensureHuman('demo');
});

afterEach(() => {
  scratch.cleanup();
});

const settledAsk = () => {
  const asked = scratch.store.askQuestion({
    as: 'api',
    questions: [
      {
        header: null,
        multi_select: false,
        options: [
          { description: null, label: 'ship it', recommended: false },
          { description: null, label: 'wait', recommended: false },
        ],
        question: 'merge now?',
      },
    ],
    room: 'demo',
  });
  if (!asked.ok) throw new Error(asked.reason);
  scratch.store.answerQuestion({ answers: [{ other: null, picks: [0] }], id: asked.question.id });
  return asked.question.id;
};

const settledIds = () =>
  buildSnapshot({ build: null, store: scratch.store }).rooms[0]!.settled_questions.map(question => question.id);

describe('buildSnapshot', () => {
  it('sends only the settled asks whose line is in the message page', () => {
    const older = settledAsk();
    for (const i of Array.from({ length: FEED_SNAPSHOT_MESSAGES }, (_, n) => n)) {
      scratch.store.postMessage({ from: 'api', room: 'demo', text: `line ${i}` });
    }
    const newer = settledAsk();

    expect(settledIds()).toStrictEqual([newer]);
    expect(settledIds()).not.toContain(older);
  });
});
