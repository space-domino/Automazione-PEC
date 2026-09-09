import { describe, expect, it } from "vitest";

describe("lib/env", () => {
  it("carica le variabili obbligatorie con i default di test", async () => {
    const { env, features, isTest } = await import("@/lib/env");
    expect(env.NODE_ENV).toBe("test");
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.PEC_SMTP_PORT).toBe(465);
    expect(isTest).toBe(true);
    expect(features.ai).toBe(false);
    expect(features.stripe).toBe(false);
  });
});
