import type { BusEvent, MemberChange, RoomChange } from '../../contracts/events.ts';
import type { Snapshot } from '../../contracts/feed.ts';
import type { Member, Message, Room } from '../../contracts/room.ts';

import pc from 'picocolors';

import { HUMAN_NAME } from '../../contracts/room.ts';

// Lines with no time line up under the text of lines that have one ("HH:MM  ").
const GUTTER = ' '.repeat(7);

const MEMBER_MARKS: Record<MemberChange, string> = { joined: '+', left: '-', reconnected: '+', role: '*' };
const ROOM_WORDS: Record<RoomChange, (room: Room) => string> = {
  closed: () => 'closed',
  created: () => 'created',
  reopened: () => 'reopened',
  topic: room => `topic: ${room.topic ?? 'cleared'}`,
};

const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const tagOf = (room: string, filter: string | undefined) => (filter ? '' : `${pc.bold(`#${room}`)}  `);
const nameOf = (name: string) => (name === HUMAN_NAME ? pc.bold(pc.magenta(name)) : pc.cyan(name));

function messageLine({ message, tag }: { message: Message; tag: string }) {
  const time = clock(message.created_at);
  if (message.kind === 'system') return pc.dim(`${time}  ${tag}${message.text}`);
  const to = message.mentions.length ? pc.dim(` → ${message.mentions.map(name => `@${name}`).join(' ')}`) : '';
  const text = message.kind === 'done' ? `${pc.green('✓')} ${message.text}` : message.text;
  return `${pc.dim(time)}  ${tag}${nameOf(message.from)}${to}  ${text}`;
}

function memberLine(member: Member, change: MemberChange) {
  if (change === 'role') return `${MEMBER_MARKS.role} ${member.name} is now ${member.role}`;
  return `${MEMBER_MARKS[change]} ${member.name} ${change}${change === 'left' ? '' : ` (${member.kind})`}`;
}

type SnapshotRoom = Snapshot['rooms'][number];

const stateOf = (room: SnapshotRoom) => [room.closed_at ? 'closed' : 'open', ...(room.standing ? ['standing'] : [])];
const postsOf = (room: SnapshotRoom) => `${room.message_count}/${room.message_cap} posts`;

// The snapshot keeps members who left so old posts keep a sender. Lists and counts skip them.
const present = (members: Member[]) => members.filter(item => item.presence !== 'left');
const memberList = (members: Member[]) =>
  members.map(item => (item.kind === 'human' ? nameOf(item.name) : `${nameOf(item.name)} ${item.presence}`)).join(', ');

/** The lines for one feed event, or none when `room` is set and the event is from another room. */
export function renderEvent({ event, room }: { event: BusEvent; room?: string }) {
  const name = event.type === 'room' ? event.room.name : event.room;
  if (room && name !== room) return [];
  const tag = tagOf(name, room);
  if (event.type === 'message') return [messageLine({ message: event.message, tag })];
  if (event.type === 'member') return [pc.dim(`${GUTTER}${tag}${memberLine(event.member, event.change)}`)];
  if (event.type === 'presence') return [pc.dim(`${GUTTER}${tag}· ${event.name} ${event.from} → ${event.to}`)];
  return [pc.dim(`${GUTTER}· #${name} ${ROOM_WORDS[event.change](event.room)}`)];
}

/** Each room (or only `room`) as a header, its members and its last messages. */
export function renderSnapshot({ room, snapshot }: { room?: string; snapshot: Snapshot }) {
  const rooms = snapshot.rooms.filter(item => !room || item.name === room);
  if (room && !rooms.length) return [pc.yellow(`no room #${room} yet, it shows up when an agent joins`)];
  if (!rooms.length) return [pc.dim('no rooms yet')];
  return rooms.flatMap((item, index) => [
    ...(index ? [''] : []),
    `${pc.bold(`#${item.name}`)}  ${pc.dim([...stateOf(item), postsOf(item), item.topic].filter(Boolean).join(', '))}`,
    `${GUTTER}${present(item.members).length ? memberList(present(item.members)) : pc.dim('nobody here')}`,
    ...item.messages.map(message => messageLine({ message, tag: '' })),
  ]);
}

/** One line per room, for `/rooms`. */
export function renderRooms({ snapshot }: { snapshot: Snapshot }) {
  if (!snapshot.rooms.length) return [pc.dim('no rooms yet')];
  return snapshot.rooms.map(item => {
    const parts = [...stateOf(item), `${present(item.members).length} members`, postsOf(item), item.topic];
    return `${pc.bold(`#${item.name}`)}  ${pc.dim(parts.filter(Boolean).join(', '))}`;
  });
}
