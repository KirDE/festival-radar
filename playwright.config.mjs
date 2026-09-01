import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:3245", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3245",
    url: "http://localhost:3245",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_SECRET: "admin-e2e-secret-at-least-32-characters",
      APP_URL: "http://localhost:3245",
      ADMIN_EMAILS: "browser-admin@example.test,browser-editor@example.test,browser-viewer@example.test",
      SUBMISSION_HASH_SALT: "browser-submission-test-salt",
    },
  },
});
