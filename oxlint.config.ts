import type { DummyRuleMap, ExternalPluginEntry } from 'oxlint';

import oxlintConfig from '@readme/oxlint-config';
import oxlintConfigVitest from '@readme/oxlint-config/testing/vitest';
import oxlintConfigTS from '@readme/oxlint-config/typescript';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [oxlintConfig],
  plugins: ['import', 'typescript', 'unicorn'],
  options: {
    reportUnusedDisableDirectives: 'error',
  },
  ignorePatterns: ['**/.claude/**', '**/dist/**', '**/node_modules/**'],
  env: {
    es2022: true,
    node: true,
  },
  rules: {
    'no-console': ['error', { allow: ['log', 'warn', 'error', 'dir'] }],
    'unicorn/prefer-node-protocol': 'error',
  },
  overrides: [
    {
      files: ['**/*.ts'],
      ...oxlintConfigTS,
    },
    {
      files: ['**/*.test.ts'],
      plugins: Array.from(new Set(['typescript', ...(oxlintConfigVitest.plugins as string[])])),
      jsPlugins: oxlintConfigVitest.jsPlugins as ExternalPluginEntry[],
      rules: Object.assign(structuredClone(oxlintConfigVitest.rules) as DummyRuleMap, {
        'typescript/no-empty-function': 'off',
        'vitest/require-hook': 'off',
      }),
    },
    {
      // MCP and the daemon own stdout, so they log to stderr only.
      files: ['src/mcp/**/*.ts', 'src/daemon/**/*.ts'],
      rules: {
        'no-console': ['error', { allow: ['error'] }],
      },
    },
  ],
});
