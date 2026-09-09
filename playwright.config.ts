import { defineConfig } from "@playwright/test";

/**
 * E2E richiede lo stack di appoggio attivo e il DB migrato:
 *   docker compose up -d postgres redis
 *   npm run db:migrate:dev && npm run db:seed
 *
 * Playwright avvia `npm run dev` da solo (a meno di E2E_NO_SERVER=1).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
