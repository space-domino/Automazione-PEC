import { expect, test } from "@playwright/test";

/**
 * Verifica LIVE della disponibilità (RDAP/WHOIS reali, gratis, nessun auth).
 * Richiede stack completo + worker. Salta di default:
 *   E2E_RUN_AVAILABILITY=1 npm run test:e2e
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@localhost";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "changeme-dev-only";

test.describe("Domain availability", () => {
  test.skip(!process.env.E2E_RUN_AVAILABILITY, "richiede stack completo + rete verso RDAP/WHOIS");

  test("la pagina Domini carica e mostra i filtri", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(EMAIL);
    await page.getByPlaceholder("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Accedi" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/domains");
    await expect(page.getByRole("heading", { name: "Domini" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Disponibili" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Verifica tutti/ })).toBeVisible();
  });
});
