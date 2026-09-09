import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue("OK") },
}));

import { _resetRdapCaches, rdapCheck, tldOf } from "@/services/availability/rdap";

type MockResp = { status?: number; jsonBody?: unknown; headers?: Record<string, string> };

function mockFetch(handler: (url: string) => MockResp) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    const r = handler(url);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      json: async () => r.jsonBody ?? {},
      // rdap.ts usa .finally() sulla promise di fetch
    } as unknown as Response;
  });
}

beforeEach(() => _resetRdapCaches());
afterEach(() => vi.unstubAllGlobals());

describe("tldOf", () => {
  it("estrae il TLD", () => {
    expect(tldOf("alfacostruzioni.it")).toBe("it");
    expect(tldOf("www.example.co.uk")).toBe("uk");
    expect(tldOf("EXAMPLE.COM.")).toBe("com");
  });
});

const BOOT_IT = { services: [[["it"], ["https://rdap.registro.it/"]]] };
const BOOT_COM = { services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] };

describe("rdapCheck", () => {
  it("bootstrap IANA + 404 -> AVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) => (url.includes("data.iana.org") ? { jsonBody: BOOT_IT } : { status: 404 })),
    );
    const r = await rdapCheck("liberissimo-9f2c.it");
    expect(r.supported).toBe(true);
    expect(r.result).toBe("AVAILABLE");
    expect(r.provider).toContain("rdap.registro.it");
    expect(r.statusCode).toBe(404);
  });

  it("200 -> REGISTERED con meta (status/events/ldhName)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) =>
        url.includes("data.iana.org")
          ? { jsonBody: BOOT_COM }
          : {
              status: 200,
              jsonBody: {
                ldhName: "google.com",
                status: ["active"],
                events: [{ eventAction: "registration" }],
              },
            },
      ),
    );
    const r = await rdapCheck("google.com");
    expect(r.result).toBe("REGISTERED");
    expect(r.meta?.ldhName).toBe("google.com");
    expect(Array.isArray(r.meta?.status)).toBe(true);
  });

  it("429 ripetuto -> UNKNOWN (mai AVAILABLE)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) =>
        url.includes("data.iana.org")
          ? { jsonBody: BOOT_IT }
          : { status: 429, headers: { "retry-after": "0.01" } },
      ),
    );
    const r = await rdapCheck("busy.it");
    expect(r.result).toBe("UNKNOWN");
    expect(r.statusCode).toBe(429);
  });

  it("errore di rete -> ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        if (String(input).includes("data.iana.org")) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => BOOT_IT,
          } as unknown as Response;
        }
        throw new Error("ECONNRESET");
      }),
    );
    const r = await rdapCheck("broken.it");
    expect(r.result).toBe("ERROR");
    expect(r.error).toContain("ECONNRESET");
  });

  it("TLD senza endpoint RDAP -> supported=false", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url) =>
        url.includes("data.iana.org") ? { jsonBody: BOOT_COM } : { status: 200 },
      ),
    );
    const r = await rdapCheck("thing.zzzznope");
    expect(r.supported).toBe(false);
    expect(r.result).toBe("UNKNOWN");
  });
});
