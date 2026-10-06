import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:sqlite warns on every import on Node 22.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    include: ['test/**/*.test.ts'],
  },
});
