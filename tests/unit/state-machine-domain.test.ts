import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  domain: { findUnique: vi.fn(), update: vi.fn() },
  stateTransition: { create: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  db: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}));

import {
  GuardFailedError,
  InvalidTransitionError,
  domainStateConfig,
  forceTransition,
  transition,
} from "@/services/state-machine";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;

const ROW = {
  id: "d1",
  status: "AVAILABLE",
  deletedAt: null,
  availabilityResult: "AVAILABLE",
  sellingPrice: null,
  isBlocked: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  m(tx.domain.findUnique).mockResolvedValue({ ...ROW });
  m(tx.domain.update).mockResolvedValue({});
  m(tx.stateTransition.create).mockResolvedValue({});
  m(tx.auditLog.create).mockResolvedValue({});
});

describe("transition (Domain)", () => {
  it("AVAILABLE -> PURCHASED (disponibile): applica + StateTransition + AuditLog", async () => {
    const r = await transition(
      domainStateConfig,
      "d1",
      "PURCHASED",
      { actorType: "USER" },
      { purchasePrice: 12 },
    );
    expect(r).toEqual({ from: "AVAILABLE", to: "PURCHASED", changed: true });
    expect(tx.domain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PURCHASED", purchasePrice: 12 }),
      }),
    );
    expect(tx.stateTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("DISCOVERED -> PURCHASED (fuori mappa): InvalidTransitionError, nessuna scrittura", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, status: "DISCOVERED" });
    await expect(transition(domainStateConfig, "d1", "PURCHASED")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect(tx.domain.update).not.toHaveBeenCalled();
    expect(tx.stateTransition.create).not.toHaveBeenCalled();
  });

  it("guardia disponibilità: AVAILABLE -> PURCHASED con UNKNOWN -> GuardFailedError", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, availabilityResult: "UNKNOWN" });
    await expect(transition(domainStateConfig, "d1", "PURCHASED")).rejects.toBeInstanceOf(
      GuardFailedError,
    );
  });

  it("metadata.override salta la guardia di disponibilità", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, availabilityResult: "UNKNOWN" });
    const r = await transition(domainStateConfig, "d1", "PURCHASED", {
      metadata: { override: true },
    });
    expect(r.changed).toBe(true);
  });

  it("no-op quando from === to", async () => {
    const r = await transition(domainStateConfig, "d1", "AVAILABLE");
    expect(r).toEqual({ from: "AVAILABLE", to: "AVAILABLE", changed: false });
    expect(tx.stateTransition.create).not.toHaveBeenCalled();
  });

  it("dominio eliminato -> InvalidTransitionError", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, deletedAt: new Date() });
    await expect(transition(domainStateConfig, "d1", "PURCHASED")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it("PURCHASED -> OFFER_DRAFT senza sellingPrice -> GuardFailedError", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, status: "PURCHASED", sellingPrice: null });
    await expect(transition(domainStateConfig, "d1", "OFFER_DRAFT")).rejects.toBeInstanceOf(
      GuardFailedError,
    );
  });
});

describe("forceTransition (Domain)", () => {
  it("vieta l'ingresso negli stati protetti", async () => {
    await expect(
      forceTransition(domainStateConfig, "d1", "PAID", { reason: "x" }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(
      forceTransition(domainStateConfig, "d1", "TRANSFERRED", { reason: "x" }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("salta la mappa ma applica le guardie", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, status: "DISCOVERED", sellingPrice: null });
    await expect(
      forceTransition(domainStateConfig, "d1", "OFFER_DRAFT", { reason: "test" }),
    ).rejects.toBeInstanceOf(GuardFailedError);
  });

  it("forza una transizione fuori mappa e marca forced", async () => {
    m(tx.domain.findUnique).mockResolvedValue({ ...ROW, status: "REGISTERED", sellingPrice: 499 });
    const r = await forceTransition(domainStateConfig, "d1", "OFFER_DRAFT", {
      reason: "correzione manuale",
    });
    expect(r).toEqual({ from: "REGISTERED", to: "OFFER_DRAFT", changed: true });
    expect(m(tx.stateTransition.create).mock.calls[0][0].data.metadata).toMatchObject({
      forced: true,
    });
    expect(m(tx.auditLog.create).mock.calls[0][0].data.action).toBe("domain.transition.forced");
  });
});
