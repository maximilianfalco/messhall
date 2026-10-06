import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const FEATURE_MAP_PATH = fileURLToPath(
  new URL('../../../.claude/skills/messhall-control/references/feature-map.md', import.meta.url),
);
