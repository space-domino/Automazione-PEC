import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    domain: { findUnique: vi.fn(), update: vi.fn() },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
      // updateDomainPricing usa db.* direttamente (fuori transazione): riusiamo gli stessi mock
      domain: tx.domain,
      auditLog: tx.auditLog,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));

import { ConflictError } from "@/lib/api/errors";
import { markAsPurchased, markPurchasedSchema, updateDomainPricing } from "@/services/purchase";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { tx } = h;

beforeEach(() => {
  vi.clearAllMocks();
  m(tx.domain.findUnique).mockResolvedValue({
    id: "d1",
    status: "AVAILABLE",
    deletedAt: null,
    availabilityResult: "AVAILABLE",
    sellingPrice: null,
  });
  m(tx.domain.update).mockResolvedValue({});
  m(tx.stateTransition.create).mockResolvedValue({});
  m(tx.auditLog.create).mockResolvedValue({});
});

describe("markPurchasedSchema", () => {
  it("normalizza currency e applica i default", () => {
    const v = markPurchasedSchema.parse({ purchasePrice: "12.5", registrar: " Aruba " });
    expect(v.currency).toBe("EUR");
    expect(v.purchasePrice).toBe(12.5);
    expect(v.registrar).toBe("Aruba");
    expect(v.purchasedAt).toBeInstanceOf(Date);
  });
  it("rifiuta prezzo negativo e registrar vuoto", () => {
    expect(() => markPurchasedSchema.parse({ purchasePrice: -1, registrar: "x" })).toThrow();
    expect(() => markPurchasedSchema.parse({ purchasePrice: 1, registrar: "" })).toThrow();
  });
});

describe("markAsPurchased", () => {
  it("scrive i campi d'acquisto e transiziona a PURCHASED", async () => {
    const r = await markAsPurchased(
      "d1",
      {
        purchasePrice: 12,
        currency: "EUR",
        registrar: "Aruba",
        purchasedAt: new Date("2026-01-01"),
      },
      { userId: "u1" },
    );
    expect(r).toMatchObject({ to: "PURCHASED", changed: true });
    const data = m(tx.domain.update).mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: "PURCHASED",
      purchasePrice: 12,
      registrar: "Aruba",
      purchaseCurrency: "EUR",
      purchasedByUserId: "u1",
    });
  });

  it("con override transiziona anche se availabilityResult non è AVAILABLE", async () => {
    m(tx.domain.findUnique).mockResolvedValue({
      id: "d1",
      status: "AVAILABLE",
      deletedAt: null,
      availabilityResult: "UNKNOWN",
      sellingPrice: null,
    });
    const r = await markAsPurchased(
      "d1",
      {
        purchasePrice: 9,
        currency: "EUR",
        registrar: "Namecheap",
        purchasedAt: new Date(),
        override: true,
      },
      { userId: "u1" },
    );
    expect(r.changed).toBe(true);
  });
});

describe("updateDomainPricing", () => {
  it("aggiorna sellingPrice negli stati pre-offerta + AuditLog", async () => {
    m(tx.domain.findUnique).mockResolvedValue({
      status: "PURCHASED",
      sellingPrice: null,
      deletedAt: null,
    });
    m(tx.domain.update).mockResolvedValue({ sellingPrice: 499 });
    await updateDomainPricing("d1", { sellingPrice: 499 }, { userId: "u1" });
    expect(tx.domain.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sellingPrice: 499 } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rifiuta la modifica in stato non consentito", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ status: "SOLD", sellingPrice: 1, deletedAt: null });
    await expect(updateDomainPricing("d1", { sellingPrice: 1 }, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
