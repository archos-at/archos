import { defineConfig } from 'vitest/config';

// The integration suite against a real Postgres (scripts/test-db.sh sets CMS_TEST_DATABASE_URL).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/int/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
