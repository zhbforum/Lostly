import { defineConfig, devices } from '@playwright/test';

// Both servers must use a disposable database; never reuse a developer's running API.
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test') {
  throw new Error('E2E tests require an explicit DATABASE_URL pointing to lostly_test');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun run --cwd ../api start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: false,
      env: { DATABASE_URL: process.env.DATABASE_URL, WEB_ORIGIN: 'http://localhost:4173' },
    },
    {
      command: 'bun run preview --host localhost --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
    },
  ],
});
