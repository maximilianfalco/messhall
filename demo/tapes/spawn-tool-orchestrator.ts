// Joins a scratch daemon's room as orchestrator over real HTTP and calls spawn with the JSON in argv[2].
// Prints the tool's reply and exits 1 on a refusal. For tapes only: it reads the agent key of MESSHALL_HOME.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../src/config.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { connectHttp } from '../../src/mcp/testing.js';

const input = JSON.parse(process.argv[2] ?? '{}') as { room: string };
const key = readFileSync(path.join(dataDir(), KEY_FILES.agent), 'utf8').trim();
const { client } = await connectHttp({ key, seat: 'tape-orchestrator', url: daemonUrl() });
await client.callTool({ arguments: { as: 'orchestrator', room: input.room }, name: 'join' });
const result = await client.callTool({ arguments: input, name: 'spawn' }, { timeout: 180_000 });
const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
process.stdout.write(`${text}\n`);
await client.close();
process.exit(result.isError ? 1 : 0);
