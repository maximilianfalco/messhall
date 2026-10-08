// Helper for ask-human-questions.tape: api asks the human three questions in one ask_human call, then waits for the
// human's answer and prints the line it reads.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../src/config.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { callTool, openAgentSession } from '../../src/mcp/oneshot.js';

const room = 'demo';
const target = { key: readFileSync(path.join(dataDir(), KEY_FILES.agent), 'utf8').trim(), url: daemonUrl() };
const api = await openAgentSession({ ...target, name: 'api' });
const call = async (name: string, args: Record<string, unknown>) => {
  const reply = await callTool(api.client, name, { room, ...args });
  console.log(`api ${name}: ${reply.text}\n`);
};

await callTool(api.client, 'join', { as: 'api', room });
await call('ask_human', {
  questions: [
    {
      header: 'Merge',
      options: [
        { description: 'squash on green CI', label: 'ship it', recommended: true },
        { description: 'hold for reviewer-1', label: 'wait for review' },
      ],
      question: 'the cents migration is green on staging. merge it today?',
    },
    {
      header: 'Suites',
      multi_select: true,
      options: [{ label: 'unit' }, { label: 'e2e' }, { label: 'smoke' }],
      question: 'which suites run before the merge?',
    },
    {
      header: 'Scope',
      options: [{ label: 'api only' }, { label: 'api and web' }],
      question: 'how wide does it go?',
    },
  ],
});
await callTool(api.client, 'read_since', { room });
await call('wait', { timeout_s: 100 });
await call('read_since', {});
await api.close();
