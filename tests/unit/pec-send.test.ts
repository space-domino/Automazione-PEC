import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    communication: { findUnique: vi.fn(), update: vi.fn() },
    domain: { findUnique: vi.fn(), update: vi.fn() },
    setting: { findUnique: vi.fn() },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    store,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(store),
      communication: store.communication,
      domain: store.domain,
      setting: store.setting,
      stateTransition: store.stateTransition,
      auditLog: store.auditLog,
    },
    sendPec: vi.fn(),
    findSuppression: vi.fn(),
    enqueue: vi.fn().mockResolvedValue({ jobId: "job-1", recordId: "rec-1" }),
    rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 19, retryAfter: 3600 }),
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/env", async (orig) => {
  const actual = (await orig()) as { features: Record<string, boolean> };
  return { ...actual, features: { ...actual.features, pec: true } };
});
vi.mock("@/lib/queue", () => ({
  QUEUE_NAMES: { pec: "pec" },
  enqueue: h.enqueue,
}));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/services/pec/transport", () => ({
  sendPec: h.sendPec,
  pecFromAddress: () => "seller@pec.it",
}));
vi.mock("@/services/pec/suppression", () => ({ findSuppression: h.findSuppression }));

import { ConflictError } from "@/lib/api/errors";
import { approvePec, cancelPec, sendApprovedPec } from "@/services/pec/send";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

let commStatus: string;
let domStatus: string;

const commRow = () => ({
  id: "cm1",
  status: commStatus,
  recipient: "azienda@pec.it",
  subject: "Dominio",
  bodyHtml: "<p>ciao</p>",
  bodyText: "ciao",
  providerMessageId: null,
  deletedAt: null,
  company: { id: "c1", pec: "azienda@pec.it", vatNumber: "IT1", legalName: "Azienda" },
  offer: { domainId: "d1", domain: { id: "d1", fqdn: "eternaholding.it", status: domStatus } },
});

beforeEach(() => {
  vi.clearAllMocks();
  commStatus = "DRAFT";
  domStatus = "PEC_DRAFT";
  m(store.communication.findUnique).mockImplementation(() => Promise.resolve(commRow()));
  m(store.communication.update).mockImplementation((a: { data: { status?: string } }) => {
    if (a.data.status) commStatus = a.data.status;
    return Promise.resolve({});
  });
  m(store.domain.findUnique).mockImplementation(() =>
    Promise.resolve({ id: "d1", status: domStatus, deletedAt: null }),
  );
  m(store.domain.update).mockImplementation((a: { data: { status?: string } }) => {
    if (a.data.status) domStatus = a.data.status;
    return Promise.resolve({});
  });
  m(store.setting.findUnique).mockResolvedValue(null);
  m(store.stateTransition.create).mockResolvedValue({});
  m(store.auditLog.create).mockResolvedValue({});
  m(h.findSuppression).mockResolvedValue(null);
  m(h.sendPec).mockResolvedValue({
    messageId: "mid-1",
    accepted: ["azienda@pec.it"],
    rejected: [],
    response: "250 ok",
  });
});

describe("approvePec", () => {
  it("DRAFT -> APPROVED e Domain -> PEC_APPROVED", async () => {
    await approvePec("cm1", { userId: "u1" });
    expect(commStatus).toBe("APPROVED");
    expect(domStatus).toBe("PEC_APPROVED");
  });

  it("rifiuta se non è in DRAFT", async () => {
    commStatus = "SENT";
    await expect(approvePec("cm1", {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("rifiuta se il destinatario è soppresso", async () => {
    m(h.findSuppression).mockResolvedValue({ type: "COMPANY", reason: "OPT_OUT" });
    await expect(approvePec("cm1", {})).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("sendApprovedPec", () => {
  beforeEach(() => {
    commStatus = "APPROVED";
    domStatus = "PEC_APPROVED";
  });

  it("invia, porta Communication a SENT e Domain a PEC_SENT", async () => {
    const r = await sendApprovedPec("cm1", { userId: "u1" });
    expect(r).toMatchObject({ status: "sent", providerMessageId: "mid-1" });
    expect(h.sendPec).toHaveBeenCalledTimes(1);
    expect(commStatus).toBe("SENT");
    expect(domStatus).toBe("PEC_SENT");
    // providerMessageId scritto nella transizione SENT
    const sentCall = m(store.communication.update).mock.calls.find(
      (c: [{ data: { status?: string } }]) => c[0].data.status === "SENT",
    );
    expect(sentCall[0].data).toMatchObject({ providerMessageId: "mid-1" });
  });

  it("idempotente: già SENT -> already, nessun invio", async () => {
    commStatus = "SENT";
    const r = await sendApprovedPec("cm1", {});
    expect(r.status).toBe("already");
    expect(h.sendPec).not.toHaveBeenCalled();
  });

  it("soppressione sopravvenuta -> annulla, nessun invio", async () => {
    m(h.findSuppression).mockResolvedValue({ type: "PEC_ADDRESS", reason: "OPT_OUT" });
    const r = await sendApprovedPec("cm1", {});
    expect(r.status).toBe("suppressed");
    expect(h.sendPec).not.toHaveBeenCalled();
    expect(commStatus).toBe("CANCELLED");
  });

  it("errore SMTP -> Communication FAILED e rilancia", async () => {
    m(h.sendPec).mockRejectedValue(new Error("connessione rifiutata"));
    await expect(sendApprovedPec("cm1", {})).rejects.toThrow("connessione rifiutata");
    expect(commStatus).toBe("FAILED");
  });

  it("rispetta il rate-limit orario", async () => {
    m(h.rateLimit).mockResolvedValue({ ok: false, remaining: 0, retryAfter: 120 });
    await expect(sendApprovedPec("cm1", {})).rejects.toMatchObject({ status: 429 });
    expect(h.sendPec).not.toHaveBeenCalled();
  });
});

describe("cancelPec", () => {
  it("porta Communication a CANCELLED e Domain a OFFER_PUBLISHED", async () => {
    commStatus = "APPROVED";
    domStatus = "PEC_APPROVED";
    await cancelPec("cm1", "ci ripensiamo", { userId: "u1" });
    expect(commStatus).toBe("CANCELLED");
    expect(domStatus).toBe("OFFER_PUBLISHED");
  });
});
