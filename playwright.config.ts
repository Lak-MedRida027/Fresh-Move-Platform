import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
// The suite books seats and creates members: it must never run against production.
// BASE_URL may only point to another LOCAL server; check a deployed site with `npm run smoke`.
const BASE_URL = process.env.BASE_URL;
if (BASE_URL && !/^https?:\/\/(localhost|127\.0\.0\.1|[\w-]+\.localhost)(:\d+)?\/?$/.test(BASE_URL)) {
  throw new Error(`Refusing to run the e2e suite against ${BASE_URL}: it writes data. Use npm run smoke -- ${BASE_URL}`);
}

export default defineConfig({
  testDir: 'tests/e2e',
  // Creates the e2e trips (open / full / closed) in the LOCAL database.
  globalSetup: process.env.BASE_URL ? undefined : './tests/e2e/fixtures.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: BASE_URL
    ? undefined
    : {
        // The built Worker on workerd (Cloudflare's runtime) with the real headers/CSP.
        // Needs the local Supabase stack with seed data: npm run db:start && npm run db:seed.
        // `npm run test:e2e` builds first.
        command: `npx astro preview --port ${PORT}`,
        url: `http://localhost:${PORT}/privacy/`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
