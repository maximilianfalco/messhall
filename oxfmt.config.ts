import oxfmtConfig from '@readme/oxlint-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig(
  Object.assign(structuredClone(oxfmtConfig), {
    ignorePatterns: ['**/.claude/**', '**/dist/**', '**/*.json', 'pnpm-lock.yaml'],
  }),
);
