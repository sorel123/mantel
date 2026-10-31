import { defineConfig } from '@playwright/test';

/**
 * The smoke test runs against the production server serving the built display, as the container
 * does: `pnpm build` first, then `pnpm e2e`. Mock mode, in-memory database, no accounts.
 */
const port = 8790;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'ipad', use: { viewport: { width: 1180, height: 820 } } },
    { name: 'surface', use: { viewport: { width: 1440, height: 960 } } },
  ],
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      MOCK: '1',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: ':memory:',
      DISPLAY_DIST: './apps/display/dist',
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    },
  },
});
