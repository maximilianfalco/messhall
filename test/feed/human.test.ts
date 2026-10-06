import type { SequencedEvent } from '../../contracts/events.ts';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeResultSchema,
  humanPostResultSchema,
  newRoomResultSchema,
  reopenResultSchema,
} from '../../contracts/feed.ts';

import { feedServer } from './feedServer.js';

let feed: Awaited<ReturnType<typeof feedServer>>;

beforeEach(async () => {
  feed = await feedServer();
});

afterEach(async () => {
  await feed.close();
});

const store = () => feed.scratch.store;

function postAs(path: string, headers: Record<string, string>, body: unknown = { text: 'ship it' }) {
  return fetch(`${feed.url}${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  });
}
const human = (path: string, body?: unknown) => postAs(path, feed.headers('human'), body);

function closeRoom() {
  store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
  store().postMessage({ done: true, from: 'api', room: 'demo', text: 'all set' });
}

describe('POST /api/rooms/:name/messages', () => {
  it('posts as human with kind chat and answers 201 with the message', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    const res = await human('/api/rooms/demo/messages', { text: '@api bump the version' });

    expect(res.status).toBe(201);
    expect(humanPostResultSchema.parse(await res.json()).message).toMatchObject({
      from: 'human',
      kind: 'chat',
      mentions: ['api'],
      text: '@api bump the version',
    });
  });

  it('lands in a member read_since as human', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    store().readUnseen({ as: 'api', room: 'demo' });

    await human('/api/rooms/demo/messages', { text: 'hello from the human' });

    const read = store().readUnseen({ as: 'api', room: 'demo' });
    expect(read.ok && read.messages.map(message => [message.from, message.text])).toStrictEqual([
      ['human', 'hello from the human'],
    ]);
  });

  it('reopens a closed room before it posts', async () => {
    closeRoom();

    const res = await human('/api/rooms/demo/messages', { text: 'one more thing' });

    expect(res.status).toBe(201);
    expect(store().listRooms()[0]!.closed_at).toBeNull();
  });

  it('adds the human seat to a room that lacks it', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });
    feed.scratch.db.prepare("DELETE FROM members WHERE name = 'human'").run();

    expect((await human('/api/rooms/demo/messages')).status).toBe(201);
  });

  it.each([{}, { text: '' }, { text: 'x'.repeat(4001) }, { text: 7 }])('refuses the body %j with 400', async body => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect((await human('/api/rooms/demo/messages', body)).status).toBe(400);
  });

  it('refuses a body that is not json with 400', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    const res = await fetch(`${feed.url}/api/rooms/demo/messages`, {
      body: 'not json',
      headers: feed.headers('human'),
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('answers 404 for a room that does not exist', async () => {
    expect((await human('/api/rooms/nope/messages')).status).toBe(404);
  });
});

describe('POST /api/rooms/:name/reopen', () => {
  it('reopens a closed room with a full cap', async () => {
    closeRoom();

    const res = await human('/api/rooms/demo/reopen');

    expect(res.status).toBe(200);
    expect(reopenResultSchema.parse(await res.json()).room).toMatchObject({ closed_at: null, message_cap: 201 });
  });

  it('answers 409 for a room that is open', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect((await human('/api/rooms/demo/reopen')).status).toBe(409);
  });

  it('answers 404 for a room that does not exist', async () => {
    expect((await human('/api/rooms/nope/reopen')).status).toBe(404);
  });
});

describe('POST /api/rooms', () => {
  it('makes a standing room made by human, answers 201 and emits room created', async () => {
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const res = await human('/api/rooms', { cap: 50, name: 'planning', topic: 'q4' });

    expect(res.status).toBe(201);
    expect(newRoomResultSchema.parse(await res.json()).room).toMatchObject({
      closed_at: null,
      created_by: 'human',
      message_cap: 50,
      name: 'planning',
      standing: true,
      topic: 'q4',
    });
    expect(seen[0]!.event).toMatchObject({ change: 'created', type: 'room' });
  });

  it('ignores a created_by in the body, so the room is always made by human', async () => {
    const res = await human('/api/rooms', { created_by: 'api', name: 'planning', standing: false });

    expect(newRoomResultSchema.parse(await res.json()).room).toMatchObject({ created_by: 'human', standing: true });
  });

  it('answers 409 for a name that exists', async () => {
    store().joinRoom({ as: 'api', kind: 'claude', room: 'demo' });

    expect((await human('/api/rooms', { name: 'demo' })).status).toBe(409);
  });

  it.each([{}, { name: 'Bad Name' }, { cap: 0, name: 'ok' }, { name: 'ok', topic: '' }])(
    'refuses the body %j with 400',
    async body => {
      expect((await human('/api/rooms', body)).status).toBe(400);
    },
  );
});

describe('POST /api/rooms/:name/close', () => {
  it('closes an open room with a system line and emits room closed', async () => {
    store().createRoom({ created_by: 'human', name: 'demo' });
    const seen: SequencedEvent[] = [];
    store().events.on(event => seen.push(event));

    const res = await human('/api/rooms/demo/close');

    expect(res.status).toBe(200);
    expect(closeResultSchema.parse(await res.json()).room.closed_at).not.toBeNull();
    expect(seen.map(item => item.event.type)).toStrictEqual(['message', 'room']);
    expect(seen[1]!.event).toMatchObject({ change: 'closed' });
  });

  it('answers 409 for a room that is closed', async () => {
    closeRoom();

    expect((await human('/api/rooms/demo/close')).status).toBe(409);
  });

  it('answers 404 for a room that does not exist', async () => {
    expect((await human('/api/rooms/nope/close')).status).toBe(404);
  });
});

describe('human route keys', () => {
  it('refuses the agent key on POST /api/rooms with 403 and makes no room', async () => {
    const res = await postAs('/api/rooms', feed.headers('agent'), { name: 'planning' });

    expect(res.status).toBe(403);
    expect(store().listRooms()).toStrictEqual([]);
  });

  it('refuses no key on POST /api/rooms with 401', async () => {
    expect((await postAs('/api/rooms', {}, { name: 'planning' })).status).toBe(401);
  });

  it.each(['/api/rooms/demo/messages', '/api/rooms/demo/reopen', '/api/rooms/demo/close', '/api/rooms/nope/anything'])(
    'refuses the agent key on %s with 403 and changes nothing',
    async path => {
      closeRoom();
      const before = store().listMessages({ limit: 50, room: 'demo' });

      const res = await postAs(path, feed.headers('agent'));

      expect(res.status).toBe(403);
      expect(store().listMessages({ limit: 50, room: 'demo' })).toStrictEqual(before);
      expect(store().listRooms()[0]!.closed_at).not.toBeNull();
    },
  );

  it.each(['/api/rooms/demo/messages', '/api/rooms/demo/reopen'])('refuses no key on %s with 401', async path => {
    closeRoom();

    expect((await postAs(path, {})).status).toBe(401);
  });
});
