// One call as a claude started by hand (client claude-code, no seat header) on the scratch daemon.
// Usage: tsx plain-claude-seat.ts <as> [seat_token], prints the join reply's first line, its seat token line and my_role.
import { readAgentKey } from '../../src/cli/agentKey.js';
import { daemonUrl, dataDir } from '../../src/config.js';
import { connectHttp } from '../../src/mcp/testing.js';

const [as = 'api', seatToken] = process.argv.slice(2);
const { client, transport } = await connectHttp({
  key: readAgentKey(dataDir()),
  name: 'claude-code',
  url: daemonUrl(),
});
const text = (result: Awaited<ReturnType<typeof client.callTool>>) =>
  (result.content as { text: string }[]).map(part => part.text).join('\n');

const joined = text(
  await client.callTool({
    arguments: { as, room: 'demo', ...(seatToken ? { seat_token: seatToken } : {}) },
    name: 'join',
  }),
);
const shown = joined.split('\n').filter((line, index) => index === 0 || line.startsWith('seat token'));
console.log(shown.join('\n'));
if (!joined.startsWith('name taken')) {
  const role = text(await client.callTool({ arguments: { room: 'demo' }, name: 'my_role' }));
  console.log(role.split('\n')[0]);
}
await transport.terminateSession();
await client.close();
