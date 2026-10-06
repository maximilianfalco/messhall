import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { historySchema, snapshotSchema } from '../../contracts/feed.ts';

import { feedServer } from './feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
});

afterEach(async () => {
  await feed.close();
});

const store = () => feed.scratch.store;
const get = (path: string, kind: 'agent' | 'human' = 'agent') =>
  fetch(`${feed.url}${path}`, { headers: feed.headers(kind) });

function seed(room = 'demo', posts = 0) {
  store().joinRoom({ as: 'api', kind: 'claude', room });
  Array.from({ length: posts }, (_, n) => store().postMessage({ from: 'api', room, text: `post ${n + 1}` }));
}

describe('GET /api/snapshot', () => {
  it('gives every room with its members, messages and the current sequence', async () => {
    seed('alpha');
    seed('beta', 1);

    const res = await get('/api/snapshot');

    const body = snapshotSchema.parse(await res.json());
    expect(res.status).toBe(200);
    expect(body.seq).toBe(store().events.bounds().last);
    expect(body.rooms.map(room => [room.name, room.message_count])).toStrictEqual([
      ['alpha', 0],
      ['beta', 1],
    ]);
    expect(body.rooms[1]!.members.map(member => [member.name, member.presence])).toStrictEqual([
      ['api', 'active'],
      ['human', 'idle'],
    ]);
    expect(body.rooms[1]!.messages.map(message => message.text)).toStrictEqual(['api joined', 'post 1']);
  });

  it('keeps closed rooms with who made them and whether they stand', async () => {
    seed('alpha');
    store().createRoom({ created_by: 'human', name: 'planning' });
    store().closeRoom('planning');

    const body = snapshotSchema.parse(await (await get('/api/snapshot')).json());

    expect(body.rooms.map(room => [room.name, room.created_by, room.standing, room.closed_at !== null])).toStrictEqual([
      ['alpha', 'api', false, false],
      ['planning', 'human', true, true],
    ]);
  });

  it('caps each room at its last 50 messages', async () => {
    seed('demo', 60);

    const body = snapshotSchema.parse(await (await get('/api/snapshot')).json());

    const texts = body.rooms[0]!.messages.map(message => message.text);
    expect(texts).toHaveLength(50);
    expect(texts[0]).toBe('post 11');
    expect(texts.at(-1)).toBe('post 60');
  });
});

describe('GET /api/rooms/:name/messages', () => {
  const texts = async (res: Response) => historySchema.parse(await res.json()).messages.map(message => message.text);

  it('gives the latest page when no after is given', async () => {
    seed('demo', 3);

    await expect(texts(await get('/api/rooms/demo/messages?limit=2'))).resolves.toStrictEqual(['post 2', 'post 3']);
  });

  it('gives the page after an id', async () => {
    seed('demo', 3);

    await expect(texts(await get('/api/rooms/demo/messages?after=2&limit=1'))).resolves.toStrictEqual(['post 2']);
  });

  it('caps a page at 200', async () => {
    seed('demo', 205);

    await expect(texts(await get('/api/rooms/demo/messages?after=0&limit=500'))).resolves.toHaveLength(200);
  });

  it('gives 50 by default', async () => {
    seed('demo', 60);

    await expect(texts(await get('/api/rooms/demo/messages'))).resolves.toHaveLength(50);
  });

  it.each(['after=-1', 'limit=0', 'limit=two', 'after=1.5'])('refuses %s with 400', async query => {
    seed();

    expect((await get(`/api/rooms/demo/messages?${query}`)).status).toBe(400);
  });

  it.each(['/api/rooms/nope/messages', '/api/rooms/Bad_Name/messages', '/api/rooms/demo/other', '/api/rooms/demo'])(
    'answers 404 for %s',
    async path => {
      seed();

      expect((await get(path)).status).toBe(404);
    },
  );
});

describe('read route keys', () => {
  it.each([
    ['/api/snapshot', 'agent'],
    ['/api/snapshot', 'human'],
    ['/api/rooms/demo/messages', 'agent'],
    ['/api/rooms/demo/messages', 'human'],
  ] as const)('lets %s through with the %s key', async (path, kind) => {
    seed();

    expect((await get(path, kind)).status).toBe(200);
  });

  it.each(['/api/snapshot', '/api/rooms/demo/messages', '/api/events'])('refuses %s with no key', async path => {
    seed();

    expect((await fetch(`${feed.url}${path}`)).status).toBe(401);
  });
});
