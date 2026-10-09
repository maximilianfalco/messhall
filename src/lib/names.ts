import { NAME_PATTERN } from '../../contracts/room.ts';

const NAME_MAX = 40;

/** A folder name as a room name: lowercase, runs of anything else as one dash. Undefined when nothing is left. */
export function roleFromFolder(folder: string) {
  const name = folder
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '');
  return NAME_PATTERN.test(name) ? name : undefined;
}
