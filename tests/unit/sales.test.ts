import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    domain: { findUnique: vi.fn(), update: vi.fn() },
    offer: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    store,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(store),
      domain: store.domain,
      offer: store.offer,
      order: store.order,
      stateTransition: store.stateTransition,
      auditLog: store.auditLog,
    },
    fetchCompletedSales: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/services/spacedomino", () => ({ fetchCompletedSales: h.fetchCompletedSales }));

import { ConflictError } from "@/lib/api/errors";
import { ingestExternalSale, recordManualSale, syncExternalSales } from "@/services/sales";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

let domainStatus: string;
let offerStatus: string;

const offerRow = () => ({
  id: "o1",
  status: offerStatus,
  deletedAt: null,
  price: 499,
  currency: "EUR",
  landingPageUrl: "https://spacedomino.it/domini/eternaholding-it",
  slug: "eternaholding-it",
  domainId: "d1",
  companyId: "c1",
});

const domainRow = () => ({
  id: "d1",
  status: domainStatus,
  deletedAt: null,
  companyId: "c1",
  fqdn: "eternaholding.it",
  sld: "eternaholding",
  extension: "it",
  sellingPrice: 499,
  offer: offerRow(),
});

const saleRow = {
  orderNumber: "SD-1001",
  orderStatus: "paid",
  itemStatus: "pending",
  email: "mario@eterna.it",
  customerName: "Mario Rossi",
  paymentRef: "pi_123",
  paidAt: new Date("2026-03-01T10:00:00Z"),
  completedAt: null,
  sld: "eternaholding",
  tld: "it",
  price: 499,
  years: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  domainStatus = "OFFER_PUBLISHED";
  offerStatus = "PUBLISHED";
  m(store.domain.findUnique).mockImplementation(() => Promise.resolve(domainRow()));
  m(store.domain.update).mockImplementation((a: { data: { status: string } }) => {
    domainStatus = a.data.status;
    return Promise.resolve({});
  });
  m(store.offer.findUnique).mockImplementation(() => Promise.resolve(offerRow()));
  m(store.offer.findFirst).mockImplementation(() =>
    Promise.resolve({ ...offerRow(), domain: domainRow() }),
  );
  m(store.offer.update).mockImplementation((a: { data: { status: string } }) => {
    offerStatus = a.data.status;
    return Promise.resolve({});
  });
  m(store.stateTransition.create).mockResolvedValue({});
  m(store.auditLog.create).mockResolvedValue({});
  m(store.order.findFirst).mockResolvedValue(null);
  m(store.order.findUnique).mockResolvedValue(null);
  m(store.order.create).mockImplementation((a: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "ord1", ...a.data }),
  );
});

describe("ingestExternalSale", () => {
  it("abbina, porta Domain e Offer a SOLD e crea l'Order interno", async () => {
    const r = await ingestExternalSale(saleRow, { userId: "u1" });

    expect(r.status).toBe("sold");
    expect(domainStatus).toBe("SOLD");
    expect(offerStatus).toBe("SOLD");

    const data = m(store.order.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      offerId: "o1",
      companyId: "c1",
      domainId: "d1",
      source: "SPACEDOMINO",
      externalOrderNumber: "SD-1001",
      externalRef: "pi_123",
      customerEmail: "mario@eterna.it",
      amount: 499,
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
    });
    expect(store.auditLog.create).toHaveBeenCalled();
  });

  it("dominio non nostro -> unmatched, nessuna scrittura", async () => {
    m(store.domain.findUnique).mockResolvedValue(null);
    const r = await ingestExternalSale(saleRow, {});
    expect(r).toEqual({ status: "unmatched", fqdn: "eternaholding.it" });
    expect(store.order.create).not.toHaveBeenCalled();
  });

  it("ordine già registrato -> already (idempotenza)", async () => {
    m(store.order.findFirst).mockResolvedValue({ id: "ord-existing" });
    const r = await ingestExternalSale(saleRow, {});
    expect(r).toMatchObject({ status: "already", orderId: "ord-existing" });
    expect(store.order.create).not.toHaveBeenCalled();
  });
});

describe("syncExternalSales", () => {
  it("senza storefront collegato è uno skip pulito", async () => {
    const r = await syncExternalSales({}, {});
    expect(r.skipped).toBe("storefront-disabled");
    expect(r.scanned).toBe(0);
    expect(h.fetchCompletedSales).not.toHaveBeenCalled();
  });
});

describe("recordManualSale", () => {
  it("registra una vendita manuale come Order source=MANUAL", async () => {
    const order = await recordManualSale(
      { offerId: "o1", customerEmail: "a@b.it", amount: 500 },
      { userId: "u1" },
    );
    expect(domainStatus).toBe("SOLD");
    expect(offerStatus).toBe("SOLD");
    expect(m(store.order.create).mock.calls[0][0].data).toMatchObject({
      source: "MANUAL",
      amount: 500,
      customerEmail: "a@b.it",
    });
    expect(order.id).toBe("ord1");
  });

  it("rifiuta se l'offerta ha già un ordine", async () => {
    m(store.order.findUnique).mockResolvedValue({ id: "ord-existing" });
    await expect(
      recordManualSale({ offerId: "o1", customerEmail: "a@b.it" }, {}),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
