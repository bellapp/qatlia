import { loadEnvConfig } from '@next/env';
import { defineConfig, devices } from '@playwright/test';

// Load .env.local (and friends) the same way `next dev`/`next build` do, so
// the browser bundle's NEXT_PUBLIC_SUPABASE_URL and this config's derived
// cookie key agree — Playwright itself never reads Next's env files.
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3002',
    // Pinned so the French default is asserted against a deterministic browser
    // locale rather than whatever the host machine happens to be set to.
    locale: 'fr-FR',
    trace: 'off',
  },
  webServer: {
    command: 'npm run build && npm run start -- -p 3002',
    url: 'http://localhost:3002',
    reuseExistingServer: false,
    timeout: 180000,
  },
  timeout: 30000,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});