// Helper for mention-missing.tape: api and web hold live seats on the scratch daemon, api posts
// with mentions of members and of names not in the room, and each post reply is printed.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../src/config.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { callTool, openAgentSession } from '../../src/mcp/oneshot.js';

const room = 'checkout';
const target = { key: readFileSync(path.join(dataDir(), KEY_FILES.agent), 'utf8').trim(), url: daemonUrl() };
const api = await openAgentSession({ ...target, name: 'api' });
const web = await openAgentSession({ ...target, name: 'web' });
const say = async (session: typeof api, as: string, name: string, args: Record<string, unknown>) => {
  const reply = await callTool(session.client, name, { room, ...args });
  console.log(`${as} ${name.padEnd(10)} ${reply.text.split('\n')[0]}`);
};

await say(api, 'api', 'join', { as: 'api' });
await say(web, 'web', 'join', { as: 'web' });
await say(api, 'api', 'post', { text: '@web and @reviewer-2 can you look at the totals?' });
await say(api, 'api', 'post', { text: '@ghost @mobile @ghost ping' });
await say(api, 'api', 'post', { text: '@web cents only' });
await Promise.all([api.close(), web.close()]);
