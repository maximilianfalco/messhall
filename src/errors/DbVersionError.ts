/** Thrown when the db was written by a newer messhall, so this one does not know its schema. */
export class DbVersionError extends Error {
  override readonly name = 'DbVersionError';
  readonly found: number;
  readonly known: number;

  constructor({ found, known }: { found: number; known: number }) {
    super(`messhall.db is at schema ${found}, this messhall knows ${known}. update messhall`);
    this.found = found;
    this.known = known;
  }
}
