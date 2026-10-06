import type { Member, Message, RoomSummary } from '../../contracts/room.ts';

/** A message whose kind may be one this build does not know yet, like `summary`. */
export interface TranscriptMessage extends Omit<Message, 'kind'> {
  kind: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const day = (iso: string) => {
  const at = new Date(iso);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock(iso)}`;
};

function messageLine(message: TranscriptMessage) {
  const time = `- **${clock(message.created_at)}**`;
  const from = `\`${message.from}\``;
  if (message.kind === 'system') return `${time} *${message.text}*`;
  if (message.kind === 'done') return `${time} ${from}: ✓ ${message.text}`;
  if (message.kind === 'chat') {
    const to = message.mentions.length ? ` → ${message.mentions.map(name => `@${name}`).join(' ')}` : '';
    return `${time} ${from}${to}: ${message.text.replaceAll('\n', '\n  ')}`;
  }
  const quote = message.text.split('\n').map(line => `  > ${line}`);
  return [`${time} ${from} (${message.kind}):`, '', ...quote, ''].join('\n');
}

/** One room as markdown: title, topic, dates, members, then one line per message in local time. */
export function renderTranscript({
  members,
  messages,
  room,
}: {
  members: Member[];
  messages: TranscriptMessage[];
  room: RoomSummary;
}) {
  const closed = room.closed_at ? `closed ${day(room.closed_at)}` : 'still open';
  const lines = [
    `# #${room.name}`,
    '',
    room.topic ?? 'no topic',
    '',
    `created ${day(room.created_at)}, ${closed}, ${room.message_count} posts`,
    '',
    '## Members',
    '',
    ...(members.length ? members.map(item => `- ${item.name} (${item.kind})`) : ['- nobody']),
    '',
    '## Messages',
    '',
    ...(messages.length ? messages.map(messageLine) : ['- nothing yet']),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
