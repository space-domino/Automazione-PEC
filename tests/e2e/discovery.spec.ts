import { expect, test } from "@playwright/test";

/**
 * Richiede lo STACK COMPLETO + una vera ANTHROPIC_API_KEY in .env (chiamata a pagamento).
 * Salta di default: esegui con  E2E_RUN_DISCOVERY=1 npm run test:e2e
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@localhost";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "changeme-dev-only";

test.describe("AI domain discovery", () => {
  test.skip(
    !process.env.E2E_RUN_DISCOVERY,
    "richiede ANTHROPIC_API_KEY reale (chiamata a pagamento)",
  );

  test("Genera domini -> compaiono candidati con score/confidence", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(EMAIL);
    await page.getByPlaceholder("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Accedi" }).click();
    await page.waitForURL(/\/dashboard/);

    // apri la prima azienda in elenco
    await page.goto("/companies");
    await page.locator("tbody tr td a").first().click();
    await page.waitForURL(/\/companies\/[a-z0-9]+/i);

    await page.getByRole("button", { name: /Genera domini|Rigenera domini/ }).click();

    // il worker genera in modo asincrono: attende che compaia almeno una riga dominio
    await expect(page.locator("tbody tr td.font-mono").first()).toBeVisible({ timeout: 45_000 });
    const rows = await page.locator("tbody tr").count();
    expect(rows).toBeGreaterThan(0);
  });
});
