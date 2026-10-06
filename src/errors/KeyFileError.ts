/** Thrown when a key file exists but holds no key, since an empty key would match an empty header. */
export class KeyFileError extends Error {
  override readonly name = 'KeyFileError';

  constructor({ file }: { file: string }) {
    super(`${file} is empty. delete it and start the daemon again to make a new key`);
  }
}
