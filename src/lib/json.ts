import { StoredJsonError } from '../errors/StoredJsonError.js';

/** Parses JSON that messhall wrote itself. A failure means a damaged db, so it throws. */
export function parseStoredJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StoredJsonError({ cause: error, text });
  }
}
