import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    offer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    domain: { findUnique: vi.fn(), update: vi.fn() },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    store,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(store),
      offer: store.offer,
      domain: store.domain,
      auditLog: store.auditLog,
      stateTransition: store.stateTransition,
    },
    enqueue: vi.fn().mockResolvedValue({ jobId: "j1", recordId: "r1" }),
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/queue", () => ({
  QUEUE_NAMES: {
    import: "import",
    discovery: "discovery",
    availability: "availability",
    storefront: "storefront",
  },
  enqueue: h.enqueue,
}));

import { ConflictError, ValidationError } from "@/lib/api/errors";
import { createOffer, publishOffer } from "@/services/offers";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

beforeEach(() => {
  vi.clearAllMocks();
  m(store.domain.findUnique).mockResolvedValue({
    id: "d1",
    companyId: "c1",
    fqdn: "eternaholding.it",
    sld: "eternaholding",
    extension: "it",
    status: "PURCHASED",
    deletedAt: null,
    sellingPrice: 499,
    offer: null,
  });
  m(store.domain.update).mockResolvedValue({});
  m(store.stateTransition.create).mockResolvedValue({});
  m(store.auditLog.create).mockResolvedValue({});
  m(store.offer.create).mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "o1", ...args.data }),
  );
  m(store.offer.findUnique).mockResolvedValue({
    id: "o1",
    status: "DRAFT",
    deletedAt: null,
    price: 499,
    landingPageUrl: "https://spacedomino.it/domini/eternaholding-it",
  });
  m(store.offer.update).mockResolvedValue({ id: "o1", status: "PUBLISHED" });
  m(store.offer.findFirst).mockResolvedValue({
    id: "o1",
    status: "DRAFT",
    domainId: "d1",
    price: 499,
    deletedAt: null,
    domain: { id: "d1", status: "OFFER_DRAFT", sld: "eternaholding", extension: "it" },
  });
});

describe("createOffer", () => {
  it("crea l'offerta DRAFT, slug e landing URL corretti, e transiziona il Domain", async () => {
    const offer = await createOffer("d1", {}, { userId: "u1" });

    const data = m(store.offer.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      domainId: "d1",
      slug: "eternaholding-it",
      landingPageUrl: "https://spacedomino.it/domini/eternaholding-it",
      price: 499,
      status: "DRAFT",
      currency: "EUR",
    });
    // Domain PURCHASED -> OFFER_DRAFT
    expect(m(store.domain.update).mock.calls[0][0].data).toMatchObject({ status: "OFFER_DRAFT" });
    expect(store.auditLog.create).toHaveBeenCalled();
    expect(offer.id).toBe("o1");
  });

  it("rifiuta se il dominio ha già un'offerta", async () => {
    m(store.domain.findUnique).mockResolvedValue({
      id: "d1",
      status: "PURCHASED",
      deletedAt: null,
      offer: { id: "old" },
    });
    await expect(createOffer("d1", {}, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("rifiuta se manca il prezzo di vendita", async () => {
    m(store.domain.findUnique).mockResolvedValue({
      id: "d1",
      companyId: "c1",
      fqdn: "x.it",
      status: "PURCHASED",
      deletedAt: null,
      sellingPrice: null,
      offer: null,
    });
    await expect(createOffer("d1", {}, {})).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("publishOffer", () => {
  it("porta Offer -> PUBLISHED, Domain -> OFFER_PUBLISHED e accoda il push allo storefront", async () => {
    // l'engine ricarica il Domain via findUnique: dev'essere in OFFER_DRAFT
    m(store.domain.findUnique).mockResolvedValue({
      id: "d1",
      status: "OFFER_DRAFT",
      deletedAt: null,
    });
    await publishOffer("o1", { userId: "u1" });

    // Offer update dentro l'engine
    expect(m(store.offer.update).mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED" });
    // Domain update dentro l'engine
    expect(m(store.domain.update).mock.calls[0][0].data).toMatchObject({
      status: "OFFER_PUBLISHED",
    });
    // push in coda
    expect(h.enqueue).toHaveBeenCalledWith(
      "storefront",
      "storefront.push",
      expect.objectContaining({ offerId: "o1", sld: "eternaholding", tld: "it", price: 499 }),
      expect.objectContaining({ dedupeKey: expect.stringContaining("sf:push:o1:") }),
    );
  });

  it("rifiuta la pubblicazione da uno stato non ammesso", async () => {
    m(store.offer.findFirst).mockResolvedValue({
      id: "o1",
      status: "PUBLISHED",
      domainId: "d1",
      price: 499,
      deletedAt: null,
      domain: { id: "d1", status: "OFFER_PUBLISHED", sld: "eternaholding", extension: "it" },
    });
    await expect(publishOffer("o1", {})).rejects.toBeInstanceOf(ConflictError);
  });
});
