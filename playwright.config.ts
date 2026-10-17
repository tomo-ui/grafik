import { defineConfig, devices } from '@playwright/test';

/** testy aplikacji uruchamiane na profilach iPhone 12 (WebKit) i Pixel 7 (Chromium) */
const APP_SPECS = [
  'shell.spec.ts',
  'app.spec.ts',
  'shifts.spec.ts',
  'views.spec.ts',
  'scan.spec.ts',
  'pdf.spec.ts',
  'launch.spec.ts',
  'a11y.spec.ts',
  'csp.spec.ts',
  'offline.spec.ts',
];

/** konsola na komputer (/pc/) — osobne projekty z oknem pulpitu */
const PC_SPECS = ['pc-*.spec.ts'];

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: true,
  // pełny zestaw (WebKit + Chromium, 2 serwery) mocno obciąża maszynę — domyślne 5 s bywa za mało
  expect: { timeout: 10_000 },
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
      testMatch: APP_SPECS,
      use: { ...devices['iPhone 12'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'pixel-7',
      testMatch: APP_SPECS,
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'desktop-chromium',
      testMatch: PC_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: 'http://localhost:4173',
      },
    },
    {
      name: 'desktop-webkit',
      testMatch: PC_SPECS,
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
        baseURL: 'http://localhost:4173',
      },
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
