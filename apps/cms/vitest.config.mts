import { defineConfig } from 'vitest/config';

// The unit suite: pure rules, the import's conversion, the social hand-off, the
// choices held to the website's code. No database; `bun run test:db` runs tests/int.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.mjs', 'social/**/*.test.mjs'],
    exclude: ['tests/int/**', 'node_modules/**'],
  },
});
