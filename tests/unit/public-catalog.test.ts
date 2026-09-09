import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    offer: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: h.db }));

import { corsHeaders, preflight } from "@/lib/api/cors";
import { getPublicOfferBySlug, listPublicOffers } from "@/services/catalog/public";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;

const row = {
  slug: "eternaholding-it",
  title: "eternaholding.it",
  headline: "Il dominio perfetto",
  bodyHtml: "<p>ciao</p>",
  price: "499.00",
  currency: "EUR",
  landingPageUrl: "https://spacedomino.it/domini/eternaholding-it",
  metaTitle: null,
  metaDescription: null,
  publishedAt: new Date("2026-02-01T00:00:00Z"),
  domain: { fqdn: "eternaholding.it", sld: "eternaholding", extension: "it" },
  company: { legalName: "Eterna Holding S.r.l." },
};

beforeEach(() => {
  vi.clearAllMocks();
  m(h.db.offer.findMany).mockResolvedValue([row]);
  m(h.db.offer.count).mockResolvedValue(1);
  m(h.db.offer.findFirst).mockResolvedValue(row);
});

describe("listPublicOffers", () => {
  it("filtra solo PUBLISHED e mappa i campi sicuri", async () => {
    const res = await listPublicOffers({ page: 1, pageSize: 10 });
    expect(m(h.db.offer.findMany).mock.calls[0][0].where).toMatchObject({
      status: "PUBLISHED",
      deletedAt: null,
    });
    expect(res.data[0]).toEqual({
      slug: "eternaholding-it",
      fqdn: "eternaholding.it",
      sld: "eternaholding",
      extension: "it",
      title: "eternaholding.it",
      headline: "Il dominio perfetto",
      bodyHtml: "<p>ciao</p>",
      price: 499,
      currency: "EUR",
      landingPageUrl: "https://spacedomino.it/domini/eternaholding-it",
      metaTitle: null,
      metaDescription: null,
      companyName: "Eterna Holding S.r.l.",
      publishedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("applica il filtro estensione normalizzato", async () => {
    await listPublicOffers({ extension: ".IT" });
    expect(m(h.db.offer.findMany).mock.calls[0][0].where.domain).toEqual({ extension: "it" });
  });
});

describe("getPublicOfferBySlug", () => {
  it("ritorna null se assente", async () => {
    m(h.db.offer.findFirst).mockResolvedValue(null);
    expect(await getPublicOfferBySlug("x")).toBeNull();
  });
});

describe("CORS", () => {
  it("riflette solo le origini in whitelist", () => {
    const ok = corsHeaders(
      new Request("http://x/api", { headers: { origin: "https://spacedomino.it" } }),
    );
    expect(ok.get("Access-Control-Allow-Origin")).toBe("https://spacedomino.it");

    const bad = corsHeaders(
      new Request("http://x/api", { headers: { origin: "https://evil.example" } }),
    );
    expect(bad.get("Access-Control-Allow-Origin")).toBeNull();
    expect(bad.get("Vary")).toBe("Origin");
  });

  it("preflight risponde 204", () => {
    const res = preflight(
      new Request("http://x/api", { headers: { origin: "https://spacedomino.it" } }),
    );
    expect(res.status).toBe(204);
  });
});
