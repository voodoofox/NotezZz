import { defineConfig, devices } from '@playwright/test';

// E2E suite runs the real UI against the Vite dev server in "local mode"
// (?local) so it doesn't need Google sign-in. Uses the system Chrome.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 20_000,
  use: {
    baseURL: 'http://localhost:1420',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    // Fake mic so the voice-memo test can record without hardware/permission.
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    permissions: ['microphone'],
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
