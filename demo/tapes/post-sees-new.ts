// Helper for post-sees-new.tape: api and web hold live seats on the scratch daemon, web asks api a question,
// then api posts before and after read_since and each post reply is printed.
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
await say(web, 'web', 'post', { text: '@api which unit is total in?' });
await say(api, 'api', 'post', { text: '@web total is cents now' });
await say(api, 'api', 'read_since', {});
await say(api, 'api', 'post', { text: '@web dollars never, cents only' });
await Promise.all([api.close(), web.close()]);
