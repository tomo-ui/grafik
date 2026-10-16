import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: true,
  reporter: 'list',
  webServer: [
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 4174 --strictPort',
      url: 'http://localhost:4174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'iphone-12',
      testMatch: 'shell.spec.ts',
      use: { ...devices['iPhone 12'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'pixel-7',
      testMatch: 'shell.spec.ts',
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'iphone-12-ui',
      testMatch: 'ui.spec.ts',
      use: { ...devices['iPhone 12'], baseURL: 'http://localhost:4174' },
    },
    {
      name: 'pixel-7-ui',
      testMatch: 'ui.spec.ts',
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4174' },
    },
  ],
});
