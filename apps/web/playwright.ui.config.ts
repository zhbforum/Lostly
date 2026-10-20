import { defineConfig } from '@playwright/test';
import { deviceProfile } from './e2e/support/device-profile.ts';

// Browser layout/navigation tests mock HTTP at the boundary and never access a database.
export default defineConfig({
  tsconfig: './tsconfig.node.json',
  testDir: './e2e',
  testMatch: [
    'google-auth.spec.ts',
    'profile-ui.spec.ts',
    'account-menu.spec.ts',
    'messages-workspace.spec.ts',
    'conversation-thread.spec.ts',
    'conversation-attachments.spec.ts',
  ],
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: 'http://localhost:4175', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...deviceProfile('Desktop Chrome'),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'firefox',
      use: {
        ...deviceProfile('Desktop Firefox'),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'pixel-7',
      use: deviceProfile('Pixel 7'),
    },
    {
      name: 'iphone-13',
      use: deviceProfile('iPhone 13'),
    },
  ],
  webServer: {
    command: 'bun run preview --host localhost --port 4175 --strictPort',
    url: 'http://localhost:4175',
    reuseExistingServer: false,
  },
});
