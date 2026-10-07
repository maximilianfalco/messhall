import type { BusEvent, MemberChange, RoomChange } from '../../contracts/events.ts';
import type { Snapshot } from '../../contracts/feed.ts';
import type { Approval, Member, Message, Question, Room } from '../../contracts/room.ts';

import pc from 'picocolors';

import { HUMAN_NAME } from '../../contracts/room.ts';

// Lines with no time line up under the text of lines that have one ("HH:MM  ").
const GUTTER = ' '.repeat(7);

const MEMBER_MARKS: Record<MemberChange, string> = {
  invited: '+',
  joined: '+',
  left: '-',
  muted: '!',
  reconnected: '+',
  removed: '-',
  role: '*',
  status: '·',
  unmuted: '*',
};
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

const statusWords = ({ status }: Member) => (status ? `: ${status}` : ' cleared');

function memberLine(member: Member, change: MemberChange) {
  if (change === 'role') return `${MEMBER_MARKS.role} ${member.name} is now ${member.role}`;
  if (change === 'status') return `${MEMBER_MARKS.status} ${member.name} status${statusWords(member)}`;
  if (change === 'removed') return `${MEMBER_MARKS.removed} ${member.name} dropped out`;
  return `${MEMBER_MARKS[change]} ${member.name} ${change}${change === 'left' ? '' : ` (${member.kind})`}`;
}

const APPROVAL_WORDS: Record<Exclude<Approval['state'], 'pending'>, string> = {
  allowed: 'allowed',
  denied: 'denied',
  expired: 'expired, denied',
};

function approvalLine({ description, input_preview, member, state, tool }: Approval, tag: string) {
  if (state === 'pending') {
    return pc.yellow(`${GUTTER}${tag}? ${member} asks to use ${tool}: ${description} ${input_preview}`);
  }
  return pc.dim(`${GUTTER}${tag}· ${member} ${tool} ${APPROVAL_WORDS[state]}`);
}

const answerHint = ({ id, options }: Question) => `messhall answer ${id} <1-${options.length}>`;

const CLOSED_QUESTION_WORDS: Record<Exclude<Question['state'], 'open'>, (question: Question) => string> = {
  answered: ({ answer, options }) => `answered: ${options[answer ?? 0]}`,
  expired: () => 'expired with no answer',
  replaced: () => 'replaced by a newer one',
};

function questionLine(question: Question, tag: string) {
  const { member, message_id, state } = question;
  if (state === 'open') {
    return pc.yellow(`${GUTTER}${tag}? ${member} asks you #${message_id}, pick with: ${answerHint(question)}`);
  }
  return pc.dim(`${GUTTER}${tag}· ${member} question #${message_id} ${CLOSED_QUESTION_WORDS[state](question)}`);
}

// The asker's own line holds the question, but a watch that starts later only has the snapshot.
const openQuestionLine = (question: Question) => {
  const options = question.options.map((option, index) => `${index + 1}. ${option}`).join('  ');
  return pc.yellow(
    `${GUTTER}? ${question.member} asks you #${question.message_id}: ${question.question} ${options}. ${answerHint(question)}`,
  );
};

type SnapshotRoom = Snapshot['rooms'][number];

const stateOf = (room: SnapshotRoom) => [room.closed_at ? 'closed' : 'open', ...(room.standing ? ['standing'] : [])];
const postsOf = (room: SnapshotRoom) => `${room.message_count} posts`;

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
  if (event.type === 'approval') return [approvalLine(event.approval, tag)];
  if (event.type === 'question') return [questionLine(event.question, tag)];
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
    ...item.questions.map(openQuestionLine),
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
