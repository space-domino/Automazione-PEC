import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    offer: { findFirst: vi.fn() },
    suppressionEntry: { findFirst: vi.fn() },
    messageTemplate: { findFirst: vi.fn(), findUnique: vi.fn() },
    communication: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    domain: { findUnique: vi.fn(), update: vi.fn() },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    store,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(store),
      offer: store.offer,
      suppressionEntry: store.suppressionEntry,
      messageTemplate: store.messageTemplate,
      communication: store.communication,
      domain: store.domain,
      stateTransition: store.stateTransition,
      auditLog: store.auditLog,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn().mockResolvedValue("") }));
vi.mock("@/services/pec/transport", () => ({ pecFromAddress: () => "noreply@pec.it" }));

import { composePecDraft } from "@/services/pec/compose";
import { PecRecipientMissingError, PecSuppressedError } from "@/services/pec/errors";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

const bodyTpl = {
  id: "tb1",
  version: 2,
  type: "PEC_BODY",
  name: "default",
  isActive: true,
  bodyText: null,
  bodyHtml:
    '<p>Spett.le {{company_name}}</p><p>{{domain}} — {{price}}</p><p><a href="{{offer_url}}">offerta</a></p><p><a href="{{optout_url}}">disiscrizione</a></p>',
};
const subjectTpl = { id: "ts1", version: 1, bodyHtml: "Disponibilità del dominio {{domain}}" };

function offerBundle(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    companyId: "c1",
    domainId: "d1",
    price: 499,
    currency: "EUR",
    landingPageUrl: "https://spacedomino.it/domini/eternaholding-it",
    deletedAt: null,
    company: {
      id: "c1",
      legalName: "Eterna Holding S.r.l.",
      pec: "eterna@pec.it",
      vatNumber: "IT01",
    },
    domain: { id: "d1", fqdn: "eternaholding.it", status: "OFFER_PUBLISHED" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m(store.offer.findFirst).mockResolvedValue(offerBundle());
  m(store.suppressionEntry.findFirst).mockResolvedValue(null);
  m(store.messageTemplate.findFirst)
    .mockResolvedValueOnce(subjectTpl)
    .mockResolvedValueOnce(bodyTpl);
  m(store.communication.findFirst).mockResolvedValue(null);
  m(store.communication.create).mockImplementation((a: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "comm1", ...a.data }),
  );
  m(store.communication.update).mockImplementation((a: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "comm1", ...a.data }),
  );
  m(store.domain.findUnique).mockResolvedValue({
    id: "d1",
    status: "OFFER_PUBLISHED",
    deletedAt: null,
    sellingPrice: 499,
  });
  m(store.domain.update).mockResolvedValue({});
  m(store.stateTransition.create).mockResolvedValue({});
  m(store.auditLog.create).mockResolvedValue({});
});

describe("composePecDraft", () => {
  it("crea la bozza e porta il Domain in PEC_DRAFT", async () => {
    const comm = await composePecDraft("o1", {}, { userId: "u1" });

    const data = m(store.communication.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      companyId: "c1",
      offerId: "o1",
      channel: "PEC",
      recipient: "eterna@pec.it",
      status: "DRAFT",
      subject: "Disponibilità del dominio eternaholding.it",
    });
    expect(data.bodyHtml).toContain("Eterna Holding S.r.l.");
    expect(data.bodyHtml).toContain("eternaholding.it");
    expect(data.bodyHtml).toContain("/api/opt-out?t=");
    expect(m(store.domain.update).mock.calls[0][0].data).toMatchObject({ status: "PEC_DRAFT" });
    expect(comm.id).toBe("comm1");
  });

  it("rifiuta se l'azienda non ha PEC", async () => {
    m(store.offer.findFirst).mockResolvedValue(
      offerBundle({ company: { id: "c1", legalName: "X", pec: null, vatNumber: null } }),
    );
    await expect(composePecDraft("o1", {}, {})).rejects.toBeInstanceOf(PecRecipientMissingError);
  });

  it("rifiuta se il destinatario è in soppressione", async () => {
    m(store.suppressionEntry.findFirst).mockResolvedValue({ type: "COMPANY", reason: "OPT_OUT" });
    await expect(composePecDraft("o1", {}, {})).rejects.toBeInstanceOf(PecSuppressedError);
  });

  it("se esiste già una bozza la rigenera senza nuova transizione", async () => {
    m(store.communication.findFirst).mockResolvedValue({ id: "comm1", status: "DRAFT" });
    await composePecDraft("o1", {}, { userId: "u1" });
    expect(store.communication.update).toHaveBeenCalled();
    expect(store.communication.create).not.toHaveBeenCalled();
    expect(store.domain.update).not.toHaveBeenCalled();
  });
});
