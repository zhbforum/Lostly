import { defineConfig } from '@playwright/test';
import { deviceProfile } from './e2e/support/device-profile.ts';

// Both servers must use a disposable database; never reuse a developer's running API.
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test') {
  throw new Error('E2E tests require an explicit DATABASE_URL pointing to lostly_test');
}

export default defineConfig({
  tsconfig: './tsconfig.node.json',
  testDir: './e2e',
  testIgnore: [
    '**/account-menu.spec.ts',
    '**/profile-ui.spec.ts',
    '**/messages-workspace.spec.ts',
    '**/conversation-thread.spec.ts',
    '**/conversation-attachments.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: deviceProfile('Desktop Chrome'),
    },
    {
      name: 'firefox',
      use: deviceProfile('Desktop Firefox'),
    },
    {
      name: 'mobile-chrome',
      testMatch: ['conversations.spec.ts', 'auth.spec.ts'],
      use: deviceProfile('Pixel 7'),
    },
    {
      name: 'mobile-webkit',
      testMatch: ['conversations.spec.ts', 'auth.spec.ts'],
      use: deviceProfile('iPhone 13'),
    },
  ],
  webServer: [
    {
      command: 'bun run --cwd ../api tests/support/test-server.ts',
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
