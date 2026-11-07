import { defineConfig } from 'vitest/config';

// Database tests: run against the LOCAL Supabase stack only (npm run test:db).
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    setupFiles: ['tests/db/setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
