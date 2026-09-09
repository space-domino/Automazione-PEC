import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { setting: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn() } }));
vi.mock("@/services/availability/rdap", () => ({
  rdapCheck: vi.fn(),
  tldOf: (s: string) => s.split(".").pop(),
}));
vi.mock("@/services/availability/whois", () => ({ whoisCheck: vi.fn() }));

import { clearSettingsCache } from "@/lib/settings";
import { canAvailabilityTransition, checkAvailability } from "@/services/availability";
import { rdapCheck } from "@/services/availability/rdap";
import { whoisCheck } from "@/services/availability/whois";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;

beforeEach(() => {
  vi.clearAllMocks();
  clearSettingsCache();
});

describe("canAvailabilityTransition", () => {
  it("ammette solo transizioni coerenti", () => {
    expect(canAvailabilityTransition("DISCOVERED", "AVAILABLE")).toBe(true);
    expect(canAvailabilityTransition("DISCOVERED", "REGISTERED")).toBe(true);
    expect(canAvailabilityTransition("AVAILABLE", "REGISTERED")).toBe(true);
    expect(canAvailabilityTransition("REGISTERED", "AVAILABLE")).toBe(true);
    expect(canAvailabilityTransition("DISCOVERED", "PURCHASED")).toBe(false);
    expect(canAvailabilityTransition("SOLD", "AVAILABLE")).toBe(false);
  });
});

describe("checkAvailability", () => {
  it("RDAP definitivo -> non chiama WHOIS", async () => {
    m(rdapCheck).mockResolvedValue({
      supported: true,
      result: "REGISTERED",
      provider: "rdap:x",
      durationMs: 10,
    });
    const r = await checkAvailability("google.com");
    expect(r.result).toBe("REGISTERED");
    expect(whoisCheck).not.toHaveBeenCalled();
  });

  it("RDAP UNKNOWN -> fallback WHOIS che conclude", async () => {
    m(rdapCheck).mockResolvedValue({
      supported: true,
      result: "UNKNOWN",
      provider: "rdap:x",
      durationMs: 10,
    });
    m(whoisCheck).mockResolvedValue({
      supported: true,
      result: "AVAILABLE",
      provider: "whois:y",
      durationMs: 20,
    });
    const r = await checkAvailability("qualcosa.it");
    expect(r.result).toBe("AVAILABLE");
    expect(r.provider).toBe("whois:y");
  });

  it("RDAP UNKNOWN + WHOIS UNKNOWN -> UNKNOWN", async () => {
    m(rdapCheck).mockResolvedValue({
      supported: true,
      result: "UNKNOWN",
      provider: "rdap:x",
      durationMs: 10,
    });
    m(whoisCheck).mockResolvedValue({
      supported: true,
      result: "UNKNOWN",
      provider: "whois:y",
      durationMs: 20,
    });
    expect((await checkAvailability("x.it")).result).toBe("UNKNOWN");
  });

  it("RDAP ERROR -> ERROR", async () => {
    m(rdapCheck).mockResolvedValue({
      supported: true,
      result: "ERROR",
      provider: "rdap:x",
      error: "net",
      durationMs: 10,
    });
    m(whoisCheck).mockResolvedValue({
      supported: false,
      result: "UNKNOWN",
      provider: "whois",
      durationMs: 0,
    });
    expect((await checkAvailability("x.it")).result).toBe("ERROR");
  });

  it("RDAP non supportato -> usa WHOIS", async () => {
    m(rdapCheck).mockResolvedValue({
      supported: false,
      result: "UNKNOWN",
      provider: "rdap",
      durationMs: 5,
    });
    m(whoisCheck).mockResolvedValue({
      supported: true,
      result: "REGISTERED",
      provider: "whois:z",
      durationMs: 30,
    });
    const r = await checkAvailability("cosa.biz");
    expect(r.result).toBe("REGISTERED");
    expect(r.provider).toBe("whois:z");
  });
});
