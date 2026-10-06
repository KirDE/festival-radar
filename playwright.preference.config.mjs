import { defineConfig } from "@playwright/test";

// Run the focused browser regressions without a catalogue, accounts or database access.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "language-preference.spec.mjs",
  grep: /\[no-db\]/,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3246", serviceWorkers: "block", launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3246",
    url: "http://127.0.0.1:3246/en/submit/",
    env: { DATABASE_URL: "" },
    reuseExistingServer: false,
  },
});
