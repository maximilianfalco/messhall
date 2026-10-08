import type {
  AnswerResult,
  ApprovalResult,
  CloseResult,
  Flock,
  HumanPostResult,
  HumanRoleResult,
  MuteResult,
  NewRoomResult,
  RemoveMemberResult,
  ReopenResult,
  ReviewNudgesResult,
  SpawnResult,
} from '../../contracts/feed.ts';
import type { ApprovalBehavior } from '../../contracts/room.ts';
import type { Keys } from '../daemon/keys.js';
import type { Handler, Route } from '../daemon/router.js';
import type { Spawner } from '../flock/spawner.js';
import type { RoomStore } from '../rooms/store.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  humanAnswerSchema,
  humanApprovalSchema,
  humanPostSchema,
  humanRoleSchema,
  humanSpawnSchema,
  newRoomSchema,
} from '../../contracts/feed.ts';
import { HUMAN_NAME, nameSchema } from '../../contracts/room.ts';
import { sendJson } from '../daemon/router.js';

import {
  approvalTarget,
  memberMuteTarget,
  memberRoleTarget,
  memberTarget,
  questionTarget,
  readJson,
  roomTarget,
} from './http.js';

const NO_ROOM = { error: 'no such room' };

/** Sends the human's verdict to the agent session that asked. False when that session is gone. */
export type Relay = (verdict: { behavior: ApprovalBehavior; requestId: string; session: string }) => Promise<boolean>;

/** The human-seat routes, every one behind the human key. The agent key gets 403 before any of
 * this runs, so no agent can speak as the human, start an agent, answer a tool ask or pick a question's answer. */
export function humanRoutes({
  keys,
  relay,
  spawner,
  store,
}: {
  keys: Keys;
  relay: Relay;
  spawner: Spawner;
  store: RoomStore;
}) {
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

  const mute = (res: ServerResponse, { member, muted, room }: { member: string; muted: boolean; room: string }) => {
    if (!store.ensureHuman(room).ok) {
      sendJson(res, 404, NO_ROOM);
      return;
    }
    const result = store.muteMember({ by: HUMAN_NAME, member, muted, room });
    if (result.ok) sendJson(res, 200, { member: result.member } satisfies MuteResult);
    else if (result.reason === 'human') sendJson(res, 409, { error: 'the human seat cannot be muted' });
    else sendJson(res, 404, { error: `no member ${member} in #${room}` });
  };

  // Waits for the agent's first call, up to two minutes, so the answer says whether it really started.
  const spawn = async (req: IncomingMessage, res: ServerResponse, room: string) => {
    const body = await readJson(req);
    const parsed = humanSpawnSchema.safeParse(body.ok ? body.value : undefined);
    if (!parsed.success) {
      sendJson(res, 400, {
        error:
          'send json { name, role, cwd, instructions?, agent?, model? }: agent is claude or codex, model a plain name',
      });
      return;
    }
    const { agent, cwd, instructions, model, name, role } = parsed.data;
    if (!store.ensureHuman(room).ok) {
      sendJson(res, 404, NO_ROOM);
      return;
    }
    const launch = { agent, cwd, ...(model ? { model } : {}) };
    const result = await spawner.spawn({ by: HUMAN_NAME, instructions, launch, name, role, room });
    if (result.ok) {
      sendJson(res, 201, { member: result.member, session: result.session } satisfies SpawnResult);
      return;
    }
    switch (result.reason) {
      case 'no_cwd':
        return sendJson(res, 400, { error: `cwd ${cwd} is not a folder. give a full path that exists` });
      case 'name_reserved':
        return sendJson(res, 400, { error: `${name} is reserved` });
      case 'name_taken':
        return sendJson(res, 409, { error: `${name} is taken in #${room}, try ${result.suggestion}` });
      case 'room_closed':
        return sendJson(res, 409, { error: 'room is closed' });
      case 'no_room':
      case 'not_member':
      case 'not_allowed':
      case 'muted':
        return sendJson(res, 403, { error: `the human seat cannot spawn here: ${result.reason}` });
      case 'tmux':
        return sendJson(res, 502, { error: `tmux could not start: ${result.detail}. is tmux installed?` });
      default:
        return sendJson(res, 502, { error: `${agent} did not take its seat (${result.reason}), the seat is dropped` });
    }
  };

  const flock: Handler = async (req, res) => {
    const room = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('room') ?? undefined;
    if (room !== undefined && !nameSchema.safeParse(room).success) {
      sendJson(res, 400, { error: 'room is a room name' });
      return;
    }
    sendJson(res, 200, { seats: await spawner.list({ room }) } satisfies Flock);
  };

  const post: Handler = async (req, res) => {
    const role = memberRoleTarget(req);
    if (role) return setRole(req, res, role);
    const muting = memberMuteTarget(req);
    if (muting) return mute(res, muting);
    const target = roomTarget(req);
    if (target?.action === 'spawn') return spawn(req, res, target.name);
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
    if (target?.action === 'nudges-on' || target?.action === 'nudges-off') {
      const on = target.action === 'nudges-on';
      const result = store.setReviewNudges({ on, room: target.name });
      if (result.ok) sendJson(res, 200, { review_nudges: on } satisfies ReviewNudgesResult);
      else sendJson(res, 404, NO_ROOM);
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

  // The ask closes before the verdict goes, so two answers to one id can never both reach the agent.
  const approve: Handler = async (req, res) => {
    const id = approvalTarget(req);
    if (!id) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const body = await readJson(req);
    const parsed = humanApprovalSchema.safeParse(body.ok ? body.value : undefined);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'send json { behavior }: allow or deny' });
      return;
    }
    const { behavior } = parsed.data;
    const answered = store.answerApproval({ behavior, id });
    if (!answered.ok) {
      sendJson(res, 404, { error: `no pending ask ${id}: wrong id, or it was answered or expired` });
      return;
    }
    if (await relay({ behavior, requestId: answered.requestId, session: answered.session })) {
      sendJson(res, 200, { approvals: answered.approvals } satisfies ApprovalResult);
    } else sendJson(res, 410, { error: 'the agent that asked is gone, nothing ran' });
  };

  // The pick becomes a human line, which is why only the human key reaches this.
  const pick: Handler = async (req, res) => {
    const id = questionTarget(req);
    if (!id) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const body = await readJson(req);
    const parsed = humanAnswerSchema.safeParse(body.ok ? body.value : undefined);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'send json { option }: the index of the picked button, from 0' });
      return;
    }
    const result = store.answerQuestion({ id, option: parsed.data.option });
    if (result.ok) sendJson(res, 200, { message: result.message, question: result.question } satisfies AnswerResult);
    else if (result.reason === 'bad_option') {
      sendJson(res, 400, { error: `question ${id} has no option ${parsed.data.option}` });
    } else sendJson(res, 404, { error: `no open question ${id}: wrong id, or it was answered, replaced or expired` });
  };

  const remove: Handler = async (req, res) => {
    const target = memberTarget(req);
    if (!target) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const { member, room } = target;
    // The spawner stops a removed seat's agent on the member event.
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
    { handle: keys.requireKey('human', flock), method: 'GET', path: '/api/flock' },
    { handle: keys.requireKey('human', approve), method: 'POST', path: '/api/approvals/*' },
    { handle: keys.requireKey('human', pick), method: 'POST', path: '/api/questions/*' },
  ];
  return routes;
}
