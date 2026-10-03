import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', 'server/**/*.test.mjs', 'tools/**/*.test.mjs'],
  },
});
