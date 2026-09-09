import { decryptString, encryptString, isEncrypted } from "@/lib/crypto";
import { describe, expect, it } from "vitest";

describe("lib/crypto", () => {
  it("cifra e decifra round-trip (UTF-8, accenti)", () => {
    const plain = "EPP-àèìòù-9f3!";
    expect(decryptString(encryptString(plain))).toBe(plain);
  });

  it("IV casuale: due cifrature della stessa stringa differiscono", () => {
    expect(encryptString("x")).not.toBe(encryptString("x"));
  });

  it("token manomesso -> throw", () => {
    const t = encryptString("segreto");
    const [v, iv, tag, ct = ""] = t.split(".");
    const tampered = [v, iv, tag, `${ct.slice(0, -2)}AA`].join(".");
    expect(() => decryptString(tampered)).toThrow();
  });

  it("formato non valido -> throw", () => {
    expect(() => decryptString("nope")).toThrow();
    expect(() => decryptString("v1.a.b")).toThrow();
  });

  it("isEncrypted riconosce la forma", () => {
    expect(isEncrypted(encryptString("a"))).toBe(true);
    expect(isEncrypted("plain")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });
});
