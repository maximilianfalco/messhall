import type { Question } from '../../contracts/room.ts';
import type { DatabaseSync } from 'node:sqlite';

import { HUMAN_NAME } from '../../contracts/room.ts';

/** The prepared statements behind agents' questions to the human. Rows keep the room id and options as JSON. */
export function questionSql(db: DatabaseSync) {
  return {
    answer: db.prepare(
      "UPDATE questions SET state = 'answered', answer = ?, answered_at = ? WHERE id = ? AND state = 'open' RETURNING *",
    ),
    expireOld: db.prepare(
      "UPDATE questions SET state = 'expired', answered_at = ? WHERE state = 'open' AND created_at <= ? RETURNING *",
    ),
    insert: db.prepare(
      "INSERT INTO questions (id, room_id, member, message_id, question, options, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?) RETURNING *",
    ),
    open: db.prepare("SELECT * FROM questions WHERE id = ? AND state = 'open'"),
    openIn: db.prepare("SELECT * FROM questions WHERE room_id = ? AND state = 'open' ORDER BY created_at, rowid"),
    openOf: db.prepare(
      "SELECT * FROM questions WHERE room_id = ? AND member = ? AND state = 'open' ORDER BY created_at, rowid",
    ),
    replace: db.prepare(
      "UPDATE questions SET state = 'replaced', answered_at = ? WHERE room_id = ? AND member = ? AND state = 'open' RETURNING *",
    ),
  };
}

/** The asker's own line: the question to the human with the numbered labels under it. */
export const askText = ({ options, question }: Pick<Question, 'options' | 'question'>) =>
  [`@${HUMAN_NAME} ${question}`, ...options.map((option, index) => `${index + 1}. ${option}`)].join('\n');

/** The human's answer line. It quotes only the picked label, never the question, so agent text cannot speak as the human. */
export const answerText = ({ answer, member, message_id, options }: Question) =>
  `@${member} answer to your question #${message_id}: ${options[answer ?? 0]}`;

/** The daemon's line when nobody answered in time. */
export const expiryText = ({ member, message_id }: Question) =>
  `@${member} no answer from the human to your question #${message_id}, carry on with your best call and say which`;
