import { defineConfig, devices } from '@playwright/test';

const PORT = 4200;
const BASE_URL = `http://localhost:${PORT}`;
const PROVIDER_ORIGIN = 'http://localhost:9001';

/**
 * Browser tests of the authentication flow.
 *
 * They run the real Angular application, built with the `demo` configuration
 * (`src/environments/environment.demo.ts`, see README § "Local demo without
 * the private server"), against the local OAuth test provider
 * (`tools/mock-oauth-server/`). No private server, secret or real account is
 * involved; both processes are started by Playwright itself (`webServer`
 * below) and torn down afterwards.
 *
 * Install once:
 *   npm install
 *   npx playwright install chromium      # downloads a Chromium build; use
 *                                         # --with-deps on a fresh Linux machine
 *
 * Run:
 *   npm run e2e
 *
 * See README § "Browser tests" for what each spec file covers and for the
 * `E2E_CHROMIUM_EXECUTABLE` escape hatch on networks that cannot reach
 * Playwright's browser download host.
 */
export default defineConfig({
  testDir: './e2e',
  // The provider keeps state in memory for the whole process: tests reset it
  // themselves (see e2e/support.ts) but are easier to reason about in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'node tools/mock-oauth-server/server.mjs',
      url: `${PROVIDER_ORIGIN}/__demo/state`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15_000,
    },
    {
      command: `npx ng serve --configuration demo --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      // A cold `ng serve` compile can take a while on first run.
      timeout: 180_000,
    },
  ],
});
