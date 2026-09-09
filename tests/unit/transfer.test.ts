import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    order: { findUnique: vi.fn(), update: vi.fn() },
    domain: { findUnique: vi.fn(), update: vi.fn() },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    store,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(store),
      order: store.order,
      domain: store.domain,
      stateTransition: store.stateTransition,
      auditLog: store.auditLog,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));

import { ConflictError } from "@/lib/api/errors";
import { encryptString } from "@/lib/crypto";
import { signToken } from "@/lib/tokens";
import {
  completeTransfer,
  failTransfer,
  resolveDelivery,
  retryTransfer,
  revealAuthCode,
  startTransfer,
} from "@/services/transfer";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

let orderStatus: string;
let domainStatus: string;
let authEnc: string | null;
let transferNotes: string | null;

const orderRow = () => ({
  id: "o1",
  orderStatus,
  domainId: "d1",
  companyId: "c1",
  transferNotes,
  transferAuthCodeEnc: authEnc,
  transferMethod: "EPP_TRANSFER" as string | null,
  transferStartedAt: null,
  transferCompletedAt: null,
  domain: { id: "d1", fqdn: "eternaholding.it", status: domainStatus, registrar: "Space Domino" },
  company: { id: "c1", legalName: "Eterna Holding S.r.l." },
});

beforeEach(() => {
  vi.clearAllMocks();
  orderStatus = "PAID";
  domainStatus = "SOLD";
  authEnc = null;
  transferNotes = null;
  m(store.order.findUnique).mockImplementation(() => Promise.resolve(orderRow()));
  m(store.order.update).mockImplementation((a: { data: Record<string, unknown> }) => {
    if (typeof a.data.orderStatus === "string") orderStatus = a.data.orderStatus;
    if (typeof a.data.transferAuthCodeEnc === "string") authEnc = a.data.transferAuthCodeEnc;
    if (typeof a.data.transferNotes === "string") transferNotes = a.data.transferNotes;
    return Promise.resolve({});
  });
  m(store.domain.findUnique).mockImplementation(() =>
    Promise.resolve({ id: "d1", status: domainStatus, deletedAt: null }),
  );
  m(store.domain.update).mockImplementation((a: { data: { status?: string } }) => {
    if (a.data.status) domainStatus = a.data.status;
    return Promise.resolve({});
  });
  m(store.stateTransition.create).mockResolvedValue({});
  m(store.auditLog.create).mockResolvedValue({});
});

describe("startTransfer", () => {
  it("PAID->FULFILLMENT_PENDING, Domain SOLD->TRANSFER_PENDING, authcode cifrato", async () => {
    await startTransfer(
      "o1",
      { method: "EPP_TRANSFER", authCode: "EPP-SECRET-9" },
      { userId: "u1" },
    );
    expect(domainStatus).toBe("TRANSFER_PENDING");
    expect(orderStatus).toBe("FULFILLMENT_PENDING");
    expect(authEnc).toBeTruthy();
    expect(authEnc).toMatch(/^v1\./);
    expect(authEnc).not.toContain("EPP-SECRET-9");
  });

  it("rifiuta se l'ordine non è PAID", async () => {
    orderStatus = "FULFILLMENT_PENDING";
    await expect(startTransfer("o1", { method: "MANUAL" }, {})).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("completeTransfer", () => {
  it("Domain->TRANSFERRED e Order->COMPLETED", async () => {
    orderStatus = "FULFILLMENT_PENDING";
    domainStatus = "TRANSFER_PENDING";
    await completeTransfer("o1", {}, { userId: "u1" });
    expect(domainStatus).toBe("TRANSFERRED");
    expect(orderStatus).toBe("COMPLETED");
  });
});

describe("failTransfer / retryTransfer", () => {
  it("fail: Domain->TRANSFER_FAILED e nota aggiunta", async () => {
    domainStatus = "TRANSFER_PENDING";
    orderStatus = "FULFILLMENT_PENDING";
    await failTransfer("o1", "authcode errato", { userId: "u1" });
    expect(domainStatus).toBe("TRANSFER_FAILED");
    expect(transferNotes).toContain("authcode errato");
  });

  it("retry: Domain TRANSFER_FAILED->TRANSFER_PENDING", async () => {
    domainStatus = "TRANSFER_FAILED";
    orderStatus = "FULFILLMENT_PENDING";
    await retryTransfer("o1", {});
    expect(domainStatus).toBe("TRANSFER_PENDING");
  });
});

describe("revealAuthCode", () => {
  it("decifra, restituisce il valore in chiaro e scrive un AuditLog", async () => {
    const enc = encryptString("EPP-REVEAL-1");
    m(store.order.findUnique).mockResolvedValue({
      transferAuthCodeEnc: enc,
      domain: { fqdn: "eternaholding.it" },
    });
    const r = await revealAuthCode("o1", { userId: "u1" });
    expect(r.authCode).toBe("EPP-REVEAL-1");
    expect(store.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "transfer.authcode.reveal" }),
      }),
    );
  });

  it("nessun authcode salvato -> ConflictError", async () => {
    m(store.order.findUnique).mockResolvedValue({
      transferAuthCodeEnc: null,
      domain: { fqdn: "x.it" },
    });
    await expect(revealAuthCode("o1", {})).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("resolveDelivery", () => {
  it("token valido + trasferimento in corso -> include l'authcode in chiaro", async () => {
    const enc = encryptString("EPP-DELIV-7");
    m(store.order.findUnique).mockResolvedValue({
      transferMethod: "EPP_TRANSFER",
      transferAuthCodeEnc: enc,
      transferStartedAt: new Date(),
      transferCompletedAt: null,
      domain: { fqdn: "eternaholding.it", status: "TRANSFER_PENDING", registrar: "Space Domino" },
    });
    const token = signToken("delivery", { o: "o1" }, { ttlSec: 100 });
    const view = await resolveDelivery(token);
    expect(view?.domain).toBe("eternaholding.it");
    expect(view?.authCode).toBe("EPP-DELIV-7");
  });

  it("dominio non ancora in trasferimento -> nessun authcode", async () => {
    m(store.order.findUnique).mockResolvedValue({
      transferMethod: null,
      transferAuthCodeEnc: encryptString("x"),
      transferStartedAt: null,
      transferCompletedAt: null,
      domain: { fqdn: "x.it", status: "SOLD", registrar: null },
    });
    const token = signToken("delivery", { o: "o1" }, { ttlSec: 100 });
    const view = await resolveDelivery(token);
    expect(view?.authCode).toBeUndefined();
  });

  it("token non valido -> null", async () => {
    expect(await resolveDelivery("garbage")).toBeNull();
  });
});
