import { expect, test } from "@playwright/test";

test("una route protetta reindirizza a /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole("heading", { name: "Domain Reselling" })).toBeVisible();
});

test("una route API protetta risponde 401 con envelope", async ({ request }) => {
  const res = await request.get("/api/overview");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe("UNAUTHORIZED");
});
