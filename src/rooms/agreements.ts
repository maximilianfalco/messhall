import type { Agreement } from '../../contracts/room.ts';
import type { DatabaseSync } from 'node:sqlite';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/** The prepared statements behind agreements. Rows keep the room id and both name lists as JSON. */
export function agreementSql(db: DatabaseSync) {
  return {
    confirm: db.prepare('UPDATE agreements SET confirmed = ?, state = ?, decided_at = ? WHERE id = ? RETURNING *'),
    get: db.prepare('SELECT * FROM agreements WHERE id = ? AND room_id = ?'),
    insert: db.prepare(
      "INSERT INTO agreements (id, room_id, proposer, text, with_names, confirmed, state, replaces, created_at) VALUES (?, ?, ?, ?, ?, '[]', 'open', ?, ?) RETURNING *",
    ),
    live: db.prepare(
      "SELECT * FROM agreements WHERE room_id = ? AND state IN ('open', 'settled') ORDER BY created_at, id",
    ),
    reject: db.prepare(
      "UPDATE agreements SET state = 'rejected', rejected_by = ?, why = ?, decided_at = ? WHERE id = ? RETURNING *",
    ),
    replace: db.prepare("UPDATE agreements SET state = 'replaced', decided_at = ? WHERE id = ? RETURNING *"),
  };
}

/** True while an agreement still counts: open or settled. Rejected and replaced ones are done with. */
export const isLive = ({ state }: Pick<Agreement, 'state'>) => state === 'open' || state === 'settled';

/** True when the member is the proposer or one of the names it must be confirmed by. */
export const involves = ({ agreement, as }: { agreement: Agreement; as: string }) =>
  agreement.proposer === as || agreement.with.includes(as);

/** The parties of an agreement a replacement leaves out. A replacement names them all, so no side drops a contract alone. */
export const leftOut = ({ agreement, as, names }: { agreement: Agreement; as: string; names: readonly string[] }) =>
  [agreement.proposer, ...agreement.with].filter(name => name !== as && !names.includes(name));

/** The proposer's own line. It mentions every name, so the doorbell rings them. */
export const proposalText = ({ replaces, text, with: names }: Pick<Agreement, 'replaces' | 'text' | 'with'>) =>
  `${names.map(name => `@${name}`).join(' ')} proposal to confirm or reject${replaces ? `, replaces #${replaces}` : ''}: ${text}`;

/** The daemon's line once all named agents confirm. It skips the agreement text, so agent text never reads as messhall. */
export const settledText = ({ confirmed, id, proposer }: Agreement) =>
  `@${proposer} agreement #${id} is settled, confirmed by ${LIST.format(confirmed)}`;

/** The rejecter's own line to the proposer. */
export const rejectText = ({ id, proposer, why }: Pick<Agreement, 'id' | 'proposer'> & { why: string }) =>
  `@${proposer} rejects agreement #${id}: ${why}`;
