import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Richiede lo STACK COMPLETO: postgres + redis + `npm run dev` + `npm run worker:dev`,
 * DB migrato e seed applicato, e una sessione admin.
 *
 * Login programmatico via /api/auth (Credentials). Imposta E2E_ADMIN_EMAIL /
 * E2E_ADMIN_PASSWORD (default: admin@localhost / changeme-dev-only, come da .env).
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@localhost";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "changeme-dev-only";
const CSV = readFileSync(new URL("../fixtures/companies-messy.csv", import.meta.url));

test.describe("Import CSV end-to-end", () => {
  test.skip(!!process.env.E2E_SKIP_IMPORT, "richiede stack completo + worker");

  test("upload -> mapping -> import con conteggi coerenti", async ({ page }) => {
    // login
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(EMAIL);
    await page.getByPlaceholder("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Accedi" }).click();
    await page.waitForURL(/\/dashboard/);

    // upload
    await page.goto("/import");
    await page.setInputFiles('input[type="file"]', {
      name: "companies-messy.csv",
      mimeType: "text/csv",
      buffer: CSV,
    });
    await page.getByRole("button", { name: "Carica" }).click();
    await page.waitForURL(/\/import\/[a-z0-9]+/i);

    // mapping (le select sono precompilate dai suggerimenti)
    await expect(page.getByText("Ragione sociale")).toBeVisible();
    await page.getByRole("button", { name: "Conferma e importa" }).click();

    // attesa completamento
    await expect(page.getByText(/Stato: (COMPLETED|PARTIAL)/)).toBeVisible({ timeout: 30_000 });

    // fixture: 4 importate (Alfa, Società Città d'Arte, Beta, Gamma),
    //          1 duplicata (alfa lowercase, stessa P.IVA), 1 scartata (senza denominazione)
    await expect(page.getByTestId("count-Importate")).toHaveText("4");
    await expect(page.getByTestId("count-Duplicate")).toHaveText("1");
    await expect(page.getByTestId("count-Scartate")).toHaveText("1");
  });
});
