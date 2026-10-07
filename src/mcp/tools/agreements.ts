import type { ToolDeps } from './registry.js';
import type { McpServer } from '@modelcontextprotocol/server';

import {
  agreementsInputSchema,
  confirmInputSchema,
  proposeInputSchema,
  rejectInputSchema,
} from '../../../contracts/mcp.ts';
import { agreementsBlock } from '../render.js';

import { notJoined, refuse, registerRoomTool, removedFrom, reply } from './registry.js';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

type Refusal =
  | 'already_confirmed'
  | 'muted'
  | 'no_agreement'
  | 'no_room'
  | 'not_member'
  | 'not_named'
  | 'not_open'
  | 'room_closed'
  | 'self';

// One wording per refusal, so propose, confirm and reject say the same thing for the same cause.
function refusal({ deps, id, reason, room }: { deps: ToolDeps; id?: number; reason: Refusal; room: string }) {
  switch (reason) {
    case 'already_confirmed':
      return refuse(`you already confirmed agreement #${id}. it settles once the rest confirm.`);
    case 'muted':
      return refuse(
        `you are muted in #${room}, so you cannot take part in agreements. wait for the human to unmute you.`,
      );
    case 'no_agreement':
      return refuse(`no agreement #${id} in #${room}. call agreements to see the open and settled ones.`);
    case 'not_named':
      return refuse(`agreement #${id} does not name you. only the agents it names can confirm or reject it.`);
    case 'not_open':
      return refuse(`agreement #${id} is no longer open to that. call agreements to see where it stands.`);
    case 'room_closed':
      return refuse(`#${room} is closed, every agent said done. ask the human to post or reopen it.`);
    case 'self':
      return refuse('you cannot confirm your own proposal. name the other agents who must confirm it.');
    default:
      return removedFrom(deps.session, room);
  }
}

/** Registers `propose`: one agreement as the caller's line, rung to the agents it names. */
export function registerPropose(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'propose',
    { deps, description, inputSchema: proposeInputSchema },
    async ({ replaces, room, text, with: named }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const result = store.proposeAgreement({ as, replaces, room, text, with: named });
      if (result.ok) {
        const { id, with: names } = result.agreement;
        const who = `${LIST.format(names)} ${names.length === 1 ? 'is' : 'are'}`;
        return reply(
          `proposed agreement #${id} in #${room}. ${who} rung to confirm or reject id ${id}. it settles once every named agent confirms.`,
        );
      }
      if (result.reason === 'not_in_room') {
        const { missing } = result;
        const what = missing.length === 1 ? 'is not an agent' : 'are not agents';
        return refuse(
          `${LIST.format(missing)} ${what} in #${room}. name agents who are here, list_members shows them.`,
        );
      }
      return refusal({ deps, id: replaces, reason: result.reason, room });
    },
  );
}

/** Registers `confirm`: a named agent says yes, and the last yes settles it. */
export function registerConfirm(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(server, 'confirm', { deps, description, inputSchema: confirmInputSchema }, async ({ id, room }) => {
    const as = session.rooms.get(room);
    if (!as) return notJoined(room);
    const result = store.confirmAgreement({ as, id, room });
    if (!result.ok) return refusal({ deps, id, reason: result.reason, room });
    const { confirmed, state, with: names } = result.agreement;
    if (state === 'settled') return reply(`confirmed agreement #${id}. it is settled, every named agent confirmed.`);
    return reply(
      `confirmed agreement #${id}. it still waits on ${LIST.format(names.filter(name => !confirmed.includes(name)))}.`,
    );
  });
}

/** Registers `reject`: a named agent says no, with why as its own line. */
export function registerReject(server: McpServer, deps: ToolDeps, description: string) {
  const { session, store } = deps;
  registerRoomTool(
    server,
    'reject',
    { deps, description, inputSchema: rejectInputSchema },
    async ({ id, room, why }) => {
      const as = session.rooms.get(room);
      if (!as) return notJoined(room);
      const result = store.rejectAgreement({ as, id, room, why });
      if (!result.ok) return refusal({ deps, id, reason: result.reason, room });
      return reply(
        `rejected agreement #${id}. ${result.agreement.proposer} is rung with your why. propose what you would take instead.`,
      );
    },
  );
}

/** Registers `agreements`: the open and settled ones in a room, no join needed. */
export function registerAgreements(server: McpServer, deps: ToolDeps, description: string) {
  const { store } = deps;
  registerRoomTool(
    server,
    'agreements',
    { deps, description, inputSchema: agreementsInputSchema },
    async ({ room }) => {
      if (!store.listRooms().some(item => item.name === room)) {
        return refuse(`no room #${room}. call list_rooms to see the rooms.`);
      }
      const block = agreementsBlock({ agreements: store.agreementsIn(room), room });
      return reply(
        block.length ? block.join('\n') : `no open or settled agreements in #${room}. propose one with propose.`,
      );
    },
  );
}
