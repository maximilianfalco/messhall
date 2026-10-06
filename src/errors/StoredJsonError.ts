/** Thrown when JSON that messhall wrote to its own db does not parse, so the db is damaged. */
export class StoredJsonError extends Error {
  override readonly name = 'StoredJsonError';

  constructor({ cause, text }: { cause: unknown; text: string }) {
    super(`stored JSON does not parse: ${text.slice(0, 80)}`, { cause });
  }
}
