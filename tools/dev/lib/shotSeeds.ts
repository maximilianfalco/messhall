import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { openDb } from '../../../src/rooms/db.js';
import { askItems } from '../../../src/rooms/questions.js';
import { createRoomStore } from '../../../src/rooms/store.js';

export const CLAUDE = { name: 'claude-code', version: '2.1.289' };

// Harmless first lines and the real step at the end, so the shot proves the card shows the whole call.
const LONG_ASK = [
  '{ "command": "set -e',
  'pnpm install --frozen-lockfile',
  'pnpm build',
  'pnpm test',
  'git tag v2.0.0',
  'git push origin v2.0.0',
  'git push --force origin main',
  'npm publish --access public" }',
].join('\n');

/** Brings the deploy agent back and adds its pending tool ask, plus a long one in #release, an answered question and two open ones (one of three questions) in #launch and agreements in #contract. Runs after the daemon starts, since its start marks
 * every agent reconnecting and expires every pending ask. */
export function seedShotAsk({ dataDir, now }: { dataDir: string; now: Date }) {
  const db = openDb({ dataDir });
  try {
    const store = createRoomStore({ db, now: () => now });
    store.touch({ as: 'deployer', room: 'deploy', state: 'active' });
    store.openApproval({
      description: 'Run the staging migration',
      inputPreview: '{"command": "pnpm db:migrate --env staging"}',
      requestId: 'abcde',
      seats: [{ name: 'deployer', room: 'deploy' }],
      session: 'shot',
      tool: 'Bash',
    });
    store.joinRoom({ as: 'shipper', client: CLAUDE, kind: 'claude', room: 'release' });
    store.openApproval({
      description: 'Tag and publish the release',
      inputPreview: LONG_ASK,
      requestId: 'fghij',
      seats: [{ name: 'shipper', room: 'release' }],
      session: 'shot-long',
      tool: 'Bash',
    });
    store.joinRoom({ as: 'api', client: CLAUDE, kind: 'claude', room: 'launch' });
    store.joinRoom({ as: 'web', client: CLAUDE, kind: 'claude', room: 'launch' });
    store.setStatus({ as: 'api', room: 'launch', status: 'staging green on https://github.com/acme/shop/pull/41' });
    store.setStatus({ as: 'deployer', room: 'deploy', status: 'waiting for the go to migrate staging' });
    store.touch({ as: 'reviewer', room: 'reviews', state: 'active' });
    store.setStatus({ as: 'reviewer', room: 'reviews', status: 'reading the rounding diff' });
    store.joinRoom({ as: 'mobile', client: CLAUDE, kind: 'claude', room: 'launch' });
    const asked = store.askQuestion({
      as: 'mobile',
      questions: askItems({ options: ['this week', 'next sprint'], question: 'ship the cents banner on mobile too?' }),
      room: 'launch',
    });
    if (asked.ok) store.answerQuestion({ answers: [{ picks: [0] }], id: asked.question.id });
    store.askQuestion({
      as: 'api',
      questions: askItems({
        questions: [
          {
            header: 'Merge',
            options: [
              { description: 'squash on green CI, staging is already on it', label: 'ship it', recommended: true },
              { description: 'hold until reviewer-1 signs off', label: 'wait for review' },
            ],
            question: 'the cents migration is green on staging. merge it today?',
          },
        ],
      }),
      room: 'launch',
    });
    store.askQuestion({
      as: 'web',
      questions: askItems({
        questions: [
          {
            header: 'Notice',
            options: [
              { description: 'a strip above the cart', label: 'banner', recommended: true },
              { description: 'blocks checkout until read', label: 'modal' },
              { label: 'inline note' },
            ],
            question: 'how should checkout tell people prices moved to cents?',
          },
          {
            header: 'Screens',
            multi_select: true,
            options: [{ label: 'cart' }, { label: 'checkout' }, { label: 'receipt' }, { label: 'order history' }],
            question: 'which screens show it?',
          },
          {
            header: 'Copy',
            options: [{ label: 'prices are now exact' }, { label: 'no change for you' }],
            question: 'which line leads the notice?',
          },
        ],
      }),
      room: 'launch',
    });
    ['api', 'web', 'mobile'].forEach(as => store.joinRoom({ as, client: CLAUDE, kind: 'claude', room: 'contract' }));
    const cents = store.proposeAgreement({
      as: 'api',
      room: 'contract',
      text: 'order totals move to amount_minor, integer cents, with a 3 letter currency beside it',
      with: ['web', 'mobile'],
    });
    if (cents.ok) {
      ['web', 'mobile'].forEach(as => store.confirmAgreement({ as, id: cents.agreement.id, room: 'contract' }));
    }
    const refunds = store.proposeAgreement({
      as: 'web',
      room: 'contract',
      text: 'refunds carry amount_minor too, api ships first and web adapts the formatter after',
      with: ['api', 'mobile'],
    });
    if (refunds.ok) store.confirmAgreement({ as: 'api', id: refunds.agreement.id, room: 'contract' });
  } finally {
    db.close();
  }
}

const SHOT_SESSIONS = [
  { branch: 'rm-1234/order-totals', repo: 'checkout-api' },
  { branch: 'rm-1234/cart-page', repo: 'checkout-web' },
  { branch: 'main', repo: 'docs' },
];

/** Fake claude sessions in scratch git repos, two on one ticket, so the running cards show without a real agent.
 * Gives the daemon env that scans only them, never the sessions running on this Mac. */
export function seedShotRunning(home: string) {
  const sessions = path.join(home, 'claude-sessions');
  mkdirSync(sessions, { recursive: true });
  SHOT_SESSIONS.forEach(({ branch, repo }, index) => {
    const cwd = path.join(home, 'code', repo);
    mkdirSync(cwd, { recursive: true });
    const git = (...args: string[]) => spawnSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
    git('init', '-q', '-b', branch);
    git('-c', 'user.name=shot', '-c', 'user.email=shot@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    // This process outlives every shot, so its pid keeps each fake session alive.
    const session = { cwd, pid: process.pid, sessionId: `shot-${index + 1}`, status: index === 0 ? 'busy' : 'idle' };
    writeFileSync(path.join(sessions, `${index + 1}.json`), JSON.stringify(session));
  });
  return { MESSHALL_CLAUDE_SESSIONS: sessions, MESSHALL_CODEX_SOCKET: path.join(home, 'no-codex.sock') };
}
