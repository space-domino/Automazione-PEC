import { _internals } from "@/lib/s3";
import { describe, expect, it } from "vitest";

const { sha256Hex, hmac, signingKey } = _internals;

describe("S3 SigV4 primitive", () => {
  it("sha256 della stringa vuota è il valore canonico", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hmac è deterministico", () => {
    expect(hmac("k", "msg").toString("hex")).toBe(hmac("k", "msg").toString("hex"));
    expect(hmac("k", "a").toString("hex")).not.toBe(hmac("k", "b").toString("hex"));
  });

  it("la signing key è 32 byte e dipende dalla data", () => {
    const k1 = signingKey("secret", "20260101");
    const k2 = signingKey("secret", "20260102");
    expect(k1).toHaveLength(32);
    expect(k1.toString("hex")).not.toBe(k2.toString("hex"));
    expect(signingKey("secret", "20260101").toString("hex")).toBe(k1.toString("hex"));
  });
});
