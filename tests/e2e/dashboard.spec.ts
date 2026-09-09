import { expect, test } from "@playwright/test";

/** Richiede stack completo (DB migrato + seed + sessione admin). Gated. */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@localhost";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "changeme-dev-only";

test.describe("Dashboard M5", () => {
  test.skip(!process.env.E2E_RUN_DASHBOARD, "richiede stack completo");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(EMAIL);
    await page.getByPlaceholder("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Accedi" }).click();
    await page.waitForURL(/\/dashboard/);
  });

  test("Overview mostra i tile", async ({ page }) => {
    await expect(page.getByText("Aziende importate")).toBeVisible();
    await expect(page.getByText("Domini disponibili")).toBeVisible();
    await expect(page.getByText("Conversion")).toBeVisible();
  });

  test("Aziende: ricerca e filtri", async ({ page }) => {
    await page.goto("/companies");
    await expect(page.getByRole("heading", { name: "Aziende" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Dominio migliore" })).toBeVisible();
  });

  test("Domini: dettaglio raggiungibile", async ({ page }) => {
    await page.goto("/domains");
    const firstLink = page.locator("tbody tr td.font-mono a").first();
    if (await firstLink.count()) {
      await firstLink.click();
      await expect(page.getByText("Storico verifiche disponibilità")).toBeVisible();
    }
  });

  test("Job e Audit caricano", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Job" })).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();
  });
});
