import { defineConfig, devices } from '@playwright/test';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test') {
  throw new Error('Admin E2E tests require an explicit DATABASE_URL pointing to lostly_test');
}

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: 'http://localhost:4200', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun run --cwd ../api start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: false,
      env: { DATABASE_URL: process.env.DATABASE_URL },
    },
    {
      command: 'bun run start --host localhost --port 4200',
      url: 'http://localhost:4200',
      reuseExistingServer: false,
    },
  ],
});
