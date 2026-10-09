// Helper for muster-convener.tape: plays the first muster steps as the convener would, with no claude started.
// It opens the room as orchestrator, writes the plan from the skill's template and asks the human what done looks like.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../src/config.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { callTool, openAgentSession } from '../../src/mcp/oneshot.js';

const room = 'greet-by-time';
const plan = path.join(dataDir(), 'plans', `${room}.md`);
const target = { key: readFileSync(path.join(dataDir(), KEY_FILES.agent), 'utf8').trim(), url: daemonUrl() };
const convener = await openAgentSession({ ...target, name: 'orchestrator' });
const call = async (name: string, args: Record<string, unknown>) => {
  const reply = await callTool(convener.client, name, { room, ...args });
  console.log(`orchestrator ${name}: ${reply.text.split('\n')[0]}`);
};

await call('join', { as: 'orchestrator', topic: 'greet people by time of day, api and web' });
await call('my_role', {});
await call('post', {
  text: 'goal: greet people by time of day, api and web. next: what done looks like, then a few questions for you.',
});

mkdirSync(path.dirname(plan), { recursive: true });
copyFileSync(path.join(import.meta.dirname, '../../.claude/skills/muster/plan-template.md'), plan);
console.log(`plan: ${plan}`);

await call('ask_human', {
  questions: [
    {
      header: 'Done',
      options: [
        {
          description: 'smallest end to end change, one PR per repo',
          label: 'api returns it, web shows it',
          recommended: true,
        },
        { description: 'adds the user timezone as a setting', label: 'plus a timezone setting' },
        { description: 'no web change yet', label: 'api only' },
      ],
      question: 'greet by time of day: what is true when this is done?',
    },
  ],
});
await call('post', { text: `5 questions, 3 look, 2 ask. plan: ${plan}` });
await convener.close();
