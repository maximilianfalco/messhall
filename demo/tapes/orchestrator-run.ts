// Plays the orchestrator brief on a scratch daemon over real HTTP: read the topic, plan, hand out roles, run the gate,
// kick and wrap up. Stand-in seats join instead of spawned agents, so no claude starts. For tapes only.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { daemonUrl, dataDir } from '../../src/config.js';
import { KEY_FILES } from '../../src/daemon/keys.js';
import { connectHttp } from '../../src/mcp/testing.js';

const ROOM = 'toy';
const TOPIC = 'toy goal: api adds GET /health, web shows its status. one PR each';
const PR = { api: 'https://github.com/example/api/pull/1', web: 'https://github.com/example/web/pull/1' };

const key = readFileSync(path.join(dataDir(), KEY_FILES.agent), 'utf8').trim();
const brief = (role: string) => readFileSync(path.join('docs', 'briefs', `${role}.md`), 'utf8');

async function seat(name: string) {
  const { client } = await connectHttp({ key, seat: `tape-${name}`, url: daemonUrl() });
  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ arguments: { room: ROOM, ...args }, name: tool });
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
    if (result.isError) throw new Error(`${name} ${tool}: ${text}`);
    return text;
  };
  return { call, close: () => client.close() };
}

const step = (label: string, detail = '') => process.stdout.write(`\n[${label}] ${detail}\n`);

const orchestrator = await seat('orchestrator');
await orchestrator.call('join', { as: 'orchestrator', topic: TOPIC });
// The orchestrator role comes only from the human, here the scratch daemon's.
execFileSync('pnpm', [
  '-s',
  'dev',
  'role',
  ROOM,
  'orchestrator',
  'orchestrator',
  '--instructions',
  'docs/briefs/orchestrator.md',
]);
const rooms = await orchestrator.call('list_rooms', {});
step('goal', rooms.match(/topic (.*), \d+ posts/)?.[1]);

await orchestrator.call('post', {
  text: 'plan: reviewer-1 gates api and web. api builds GET /health in the api repo, web shows it in the web repo.',
});
step('plan', 'posted: reviewer-1 gates api and web');

const seats = { api: await seat('api'), 'reviewer-1': await seat('reviewer-1'), web: await seat('web') };
await Promise.all(Object.entries(seats).map(([name, member]) => member.call('join', { as: name })));

const give = async (name: keyof typeof seats, role: 'reviewer' | 'worker', why: string) => {
  await orchestrator.call('assign_role', { instructions: brief(role), member: name, role });
  await orchestrator.call('post', { text: `@${name} your role: ${role}, ${why}` });
  step('role', `${name}: ${(await seats[name].call('my_role', {})).split('\n')[0]}`);
};
await give('reviewer-1', 'reviewer', 'gate api and web. reviewers run on opus');
await give('api', 'worker', 'build GET /health, gate @reviewer-1, on sonnet because it is a small route');
await give('web', 'worker', 'show the health status, gate @reviewer-1, on sonnet because it is one badge');

const ship = async (worker: 'api' | 'web') => {
  await seats[worker].call('post', { text: `ready for review: ${PR[worker]} @reviewer-1` });
  await seats['reviewer-1'].call('post', { text: `approved @${worker} ${PR[worker]}` });
  await seats[worker].call('post', { done: true, text: `done: ${PR[worker]} merged` });
  await seats[worker].call('leave', { note: 'merged, leaving' });
  step('gate', `${worker}: ready for review, approved, done, left`);
};
await ship('api');
await ship('web');

await orchestrator.call('kick', { member: 'reviewer-1' });
step('kick', 'reviewer-1, the last seat still here');
await orchestrator.call('post', {
  done: true,
  text: `@human wrap-up: shipped ${PR.api} and ${PR.web}. not done: nothing.`,
});
step('wrap-up', 'posted with done: true');

await Promise.all([orchestrator, ...Object.values(seats)].map(member => member.close()));
process.exit(0);
