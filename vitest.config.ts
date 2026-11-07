import { defineConfig } from 'vitest/config';

// Unit + API tests run in plain Node (no Astro/Cloudflare runtime needed).
// Database tests have their own config (vitest.db.config.ts, local Supabase only).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
  },
});
