import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'off',
  },
  timeout: 15000,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});