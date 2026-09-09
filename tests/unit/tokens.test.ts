import { signToken, verifyToken } from "@/lib/tokens";
import { describe, expect, it } from "vitest";

describe("lib/tokens", () => {
  it("firma e verifica un token con lo stesso scope", () => {
    const t = signToken("optout", { c: "cmp_1" });
    const r = verifyToken<{ c: string }>(t, "optout");
    expect(r.ok).toBe(true);
    expect(r.payload?.c).toBe("cmp_1");
  });

  it("rifiuta scope diverso", () => {
    const t = signToken("optout", { c: "cmp_1" });
    expect(verifyToken(t, "delivery")).toMatchObject({ ok: false, reason: "wrong-scope" });
  });

  it("rifiuta firma manomessa", () => {
    const t = signToken("optout", { c: "cmp_1" });
    const [body] = t.split(".");
    expect(verifyToken(`${body}.deadbeef`, "optout")).toMatchObject({ ok: false });
  });

  it("rifiuta token malformato", () => {
    expect(verifyToken("nope", "optout")).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("rispetta la scadenza", () => {
    const t = signToken("optout", { c: "x" }, { ttlSec: -1 });
    expect(verifyToken(t, "optout")).toMatchObject({ ok: false, reason: "expired" });
  });
});
