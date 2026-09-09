import { expect, test } from "@playwright/test";

test("GET /api/health risponde ok con db e redis", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.db).toBe("ok");
  expect(body.redis).toBe("ok");
});
