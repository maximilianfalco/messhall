import type { Question, QuestionAnswer, QuestionItem } from '../../contracts/room.ts';
import type { DatabaseSync } from 'node:sqlite';

import { HUMAN_NAME } from '../../contracts/room.ts';

/** The prepared statements behind agents' questions to the human. Rows keep the room id, questions and answers as JSON. */
export function questionSql(db: DatabaseSync) {
  return {
    answer: db.prepare(
      "UPDATE questions SET state = 'answered', answers = ?, answered_at = ? WHERE id = ? AND state = 'open' RETURNING *",
    ),
    expireOld: db.prepare(
      "UPDATE questions SET state = 'expired', answered_at = ? WHERE state = 'open' AND created_at <= ? RETURNING *",
    ),
    insert: db.prepare(
      "INSERT INTO questions (id, room_id, member, message_id, items, state, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?) RETURNING *",
    ),
    open: db.prepare("SELECT * FROM questions WHERE id = ? AND state = 'open'"),
    openIn: db.prepare("SELECT * FROM questions WHERE room_id = ? AND state = 'open' ORDER BY created_at, rowid"),
    openOf: db.prepare(
      "SELECT * FROM questions WHERE room_id = ? AND member = ? AND state = 'open' ORDER BY created_at, rowid",
    ),
    replace: db.prepare(
      "UPDATE questions SET state = 'replaced', answered_at = ? WHERE room_id = ? AND member = ? AND state = 'open' RETURNING *",
    ),
    settledIn: db.prepare(
      "SELECT * FROM questions WHERE room_id = ? AND state != 'open' AND message_id >= ? ORDER BY created_at, rowid",
    ),
  };
}

interface AskOption {
  description?: string;
  label: string;
  recommended?: boolean;
}

interface AskInput {
  options?: string[];
  question?: string;
  questions?: { header: string; multi_select?: boolean; options: AskOption[]; question: string }[];
}

/** The questions in an ask_human call. The short form with one question and plain labels is one question with no header. */
export function askItems({ options = [], question = '', questions }: AskInput): QuestionItem[] {
  if (!questions) {
    const plain = options.map(label => ({ description: null, label, recommended: false }));
    return [{ header: null, multi_select: false, options: plain, question }];
  }
  return questions.map(item => ({
    header: item.header,
    multi_select: item.multi_select ?? false,
    options: item.options.map(option => ({
      description: option.description ?? null,
      label: option.label,
      recommended: option.recommended ?? false,
    })),
    question: item.question,
  }));
}

/** The human's answers as stored: no typed text is null and picks run in option order. */
export const storedAnswers = (answers: { other?: string | null; picks: number[] }[]) =>
  answers.map(({ other, picks }) => ({ other: other ?? null, picks: picks.toSorted((a, b) => a - b) }));

/** True when there is one answer per question, each picking in range with no repeats: exactly one pick or typed
 * text on a pick one question, at least one of either on a pick any one. */
export function answersFit({ answers, items }: { answers: QuestionAnswer[]; items: QuestionItem[] }) {
  if (answers.length !== items.length) return false;
  return items.every((item, index) => {
    const { other, picks } = answers[index]!;
    if (new Set(picks).size !== picks.length) return false;
    if (picks.some(pick => pick >= item.options.length)) return false;
    const chosen = picks.length + (other ? 1 : 0);
    return item.multi_select ? chosen >= 1 : chosen === 1;
  });
}

const itemLines = ({ header, multi_select, options, question }: QuestionItem) => [
  `${header ? `${header}: ` : ''}${question}${multi_select ? ' (pick any)' : ''}`,
  ...options.map(({ label, recommended }, index) => `${index + 1}. ${label}${recommended ? ' (recommended)' : ''}`),
];

/** The asker's own line: each question to the human with its numbered labels under it. */
export const askText = ({ questions }: Pick<Question, 'questions'>) => {
  const [first, ...rest] = questions.flatMap(itemLines);
  return [`@${HUMAN_NAME} ${first}`, ...rest].join('\n');
};

const pickedText = (item: QuestionItem, { other, picks }: QuestionAnswer) => {
  const picked = [...picks.map(pick => item.options[pick]?.label), ...(other ? [`"${other}"`] : [])].join(', ');
  return item.header ? `${item.header}: ${picked}` : picked;
};

/** One line per question: its header, then the picked labels and the typed text in quotes. */
export const pickedLines = ({ answers, questions }: Pick<Question, 'answers' | 'questions'>) =>
  questions.map((item, index) => pickedText(item, answers?.[index] ?? { other: null, picks: [] }));

/** The human's answer line. It quotes only headers, picked labels and what the human typed, never the question,
 * so agent text cannot speak as the human. Several questions get a line each. */
export const answerText = (question: Question) => {
  const head = `@${question.member} answer to your question #${question.message_id}:`;
  const lines = pickedLines(question);
  return lines.length === 1 ? `${head} ${lines[0]}` : [head, ...lines].join('\n');
};

/** The daemon's line when nobody answered in time. */
export const expiryText = ({ member, message_id }: Question) =>
  `@${member} no answer from the human to your question #${message_id}, carry on with your best call and say which`;
