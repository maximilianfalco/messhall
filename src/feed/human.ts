import type {
  CloseResult,
  HumanPostResult,
  HumanRoleResult,
  NewRoomResult,
  RemoveMemberResult,
  ReopenResult,
} from '../../contracts/feed.ts';
import type { Keys } from '../daemon/keys.js';
import type { Handler, Route } from '../daemon/router.js';
import type { RoomStore } from '../rooms/store.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { humanPostSchema, humanRoleSchema, newRoomSchema } from '../../contracts/feed.ts';
import { HUMAN_NAME } from '../../contracts/room.ts';
import { sendJson } from '../daemon/router.js';

import { memberRoleTarget, memberTarget, readJson, roomTarget } from './http.js';

const NO_ROOM = { error: 'no such room' };

/** The human-seat routes, every one behind the human key. The agent key gets 403 before any of
 * this runs, so no agent can speak as the human. */
export function humanRoutes({ keys, store }: { keys: Keys; store: RoomStore }) {
  const create: Handler = async (req, res) => {
    const body = await readJson(req);
    const parsed = newRoomSchema.safeParse(body.ok ? body.value : undefined);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'send json { name, topic? }: name is a-z, 0-9 and dashes' });
      return;
    }
    const result = store.createRoom({ ...parsed.data, created_by: HUMAN_NAME });
    if (result.ok) sendJson(res, 201, { room: result.room } satisfies NewRoomResult);
    else sendJson(res, 409, { error: `room #${parsed.data.name} already exists` });
  };

  const setRole = async (
    req: IncomingMessage,
    res: ServerResponse,
    { member, room }: { member: string; room: string },
  ) => {
    const body = await readJson(req);
    const parsed = humanRoleSchema.safeParse(body.ok ? body.value : undefined);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: 'send json { role, instructions? }: role is a-z, 0-9 and dashes, instructions 1 to 4000 chars',
      });
      return;
    }
    const { instructions, role } = parsed.data;
    if (!store.ensureHuman(room).ok) {
      sendJson(res, 404, NO_ROOM);
      return;
    }
    const assigned = store.assignRole({ by: HUMAN_NAME, instructions, member, role, room });
    if (!assigned.ok) {
      sendJson(res, 404, { error: `no member ${member} in #${room}` });
      return;
    }
    // The mention rings the member, which is its cue to call my_role.
    const line = store.postMessage({ from: HUMAN_NAME, room, text: `@${member} your role: ${role}` });
    if (line.ok) sendJson(res, 200, { member: assigned.member, message: line.message } satisfies HumanRoleResult);
    else sendJson(res, 409, { error: `role set, but the line was refused: ${line.reason}` });
  };

  const post: Handler = async (req, res) => {
    const role = memberRoleTarget(req);
    if (role) return setRole(req, res, role);
    const target = roomTarget(req);
    if (target?.action === 'close') {
      const result = store.closeRoom(target.name);
      if (result.ok) sendJson(res, 200, { room: result.room } satisfies CloseResult);
      else if (result.reason === 'no_room') sendJson(res, 404, NO_ROOM);
      else sendJson(res, 409, { error: 'room is closed' });
      return;
    }
    if (target?.action === 'reopen') {
      const result = store.reopenRoom(target.name);
      if (result.ok) sendJson(res, 200, { room: result.room } satisfies ReopenResult);
      else if (result.reason === 'no_room') sendJson(res, 404, NO_ROOM);
      else sendJson(res, 409, { error: 'room is open' });
      return;
    }
    if (target?.action !== 'messages') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    const body = await readJson(req);
    const parsed = humanPostSchema.safeParse(body.ok ? body.value : undefined);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'send json { text } with 1 to 4000 chars' });
      return;
    }
    if (!store.ensureHuman(target.name).ok) {
      sendJson(res, 404, NO_ROOM);
      return;
    }
    // The store reopens a closed room when the human posts.
    const result = store.postMessage({ from: HUMAN_NAME, room: target.name, text: parsed.data.text });
    if (result.ok) sendJson(res, 201, { message: result.message } satisfies HumanPostResult);
    else sendJson(res, 409, { error: `post refused: ${result.reason}` });
  };

  const remove: Handler = (req, res) => {
    const target = memberTarget(req);
    if (!target) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const { member, room } = target;
    const result = store.removeMember({ member, room });
    if (result.ok) sendJson(res, 200, { member: result.member } satisfies RemoveMemberResult);
    else if (result.reason === 'no_room') sendJson(res, 404, NO_ROOM);
    else if (result.reason === 'no_member') sendJson(res, 404, { error: `no member ${member} in #${room}` });
    else sendJson(res, 409, { error: 'the human seat cannot be removed' });
  };

  const routes: Route[] = [
    { handle: keys.requireKey('human', create), method: 'POST', path: '/api/rooms' },
    { handle: keys.requireKey('human', post), method: 'POST', path: '/api/rooms/*' },
    { handle: keys.requireKey('human', remove), method: 'DELETE', path: '/api/rooms/*' },
  ];
  return routes;
}
