import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    communication: { findUnique: vi.fn(), update: vi.fn() },
    pecReceipt: { findUnique: vi.fn(), create: vi.fn() },
    stateTransition: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    store,
    db: {
      $transaction: (fn: (t: unknown) => unknown) => fn(store),
      communication: store.communication,
      pecReceipt: store.pecReceipt,
      auditLog: store.auditLog,
      stateTransition: store.stateTransition,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));

import { classifyReceipt, ingestReceipt } from "@/services/pec/receipts";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

function buildMime(opts: {
  tipo?: string;
  ricevuta?: string;
  origId?: string;
  withAttachment?: boolean;
}): Buffer {
  const {
    tipo = "avvenuta-consegna",
    ricevuta,
    origId = "<orig-123@pec.it>",
    withAttachment = true,
  } = opts;
  const headers = [
    "From: posta-certificata@pec.aruba.it",
    "To: mittente@pec.it",
    "Subject: CONSEGNA: Disponibilita del dominio eternaholding.it",
    "Message-ID: <receipt-abc@pec.aruba.it>",
    "Date: Wed, 04 Mar 2026 10:00:00 +0100",
    "MIME-Version: 1.0",
  ];
  if (ricevuta) headers.push(`X-Ricevuta: ${ricevuta}`);
  if (!withAttachment) headers.push(`X-Riferimento-Message-ID: ${origId}`);

  if (!withAttachment) {
    return Buffer.from(
      `${headers.join("\r\n")}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nRicevuta.\r\n`,
      "utf8",
    );
  }

  const xmlOrig = origId.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0"?>\r\n<postacert tipo="${tipo}">\r\n<dati><msgid>${xmlOrig}</msgid><consegna>dest@pec.it</consegna></dati>\r\n</postacert>\r\n`;
  const body = [
    `${headers.join("\r\n")}`,
    'Content-Type: multipart/mixed; boundary="B"',
    "",
    "--B",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Ricevuta di avvenuta consegna.",
    "",
    "--B",
    'Content-Type: application/xml; name="daticert.xml"',
    'Content-Disposition: attachment; filename="daticert.xml"',
    "",
    xml,
    "--B--",
    "",
  ].join("\r\n");
  return Buffer.from(body, "utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  m(store.communication.findUnique).mockResolvedValue({ id: "c1", status: "SENT" });
  m(store.communication.update).mockResolvedValue({});
  m(store.pecReceipt.findUnique).mockResolvedValue(null);
  m(store.pecReceipt.create).mockResolvedValue({ id: "r1" });
  m(store.stateTransition.create).mockResolvedValue({});
  m(store.auditLog.create).mockResolvedValue({});
});

describe("classifyReceipt", () => {
  it("legge tipo e msgid dal daticert.xml", async () => {
    const p = await classifyReceipt(buildMime({ tipo: "avvenuta-consegna" }));
    expect(p.type).toBe("DELIVERY");
    expect(p.originalMessageId).toBe("orig-123@pec.it");
    expect(p.recipient).toBe("dest@pec.it");
  });

  it("fallback sugli header quando manca l'allegato", async () => {
    const p = await classifyReceipt(
      buildMime({ withAttachment: false, ricevuta: "accettazione", origId: "<abc@pec.it>" }),
    );
    expect(p.type).toBe("ACCEPTANCE");
    expect(p.originalMessageId).toBe("abc@pec.it");
  });

  it("tipo non-ricevuta -> type null", async () => {
    const p = await classifyReceipt(buildMime({ tipo: "posta-certificata" }));
    expect(p.type).toBeNull();
  });
});

describe("ingestReceipt", () => {
  it("archivia la ricevuta e fa avanzare la Communication a DELIVERED", async () => {
    const src = buildMime({ tipo: "avvenuta-consegna" });
    const parsed = await classifyReceipt(src);
    const r = await ingestReceipt(parsed, src);

    expect(r).toMatchObject({ status: "recorded", communicationId: "c1", type: "DELIVERY" });
    expect(store.pecReceipt.create).toHaveBeenCalled();
    expect(m(store.communication.update).mock.calls[0][0].data).toMatchObject({
      status: "DELIVERED",
    });
  });

  it("nessuna Communication collegata -> unmatched", async () => {
    m(store.communication.findUnique).mockResolvedValue(null);
    const src = buildMime({});
    const r = await ingestReceipt(await classifyReceipt(src), src);
    expect(r.status).toBe("unmatched");
    expect(store.pecReceipt.create).not.toHaveBeenCalled();
  });

  it("ricevuta già archiviata -> duplicate", async () => {
    m(store.pecReceipt.findUnique).mockResolvedValue({ id: "r-existing" });
    const src = buildMime({});
    const r = await ingestReceipt(await classifyReceipt(src), src);
    expect(r.status).toBe("duplicate");
    expect(store.pecReceipt.create).not.toHaveBeenCalled();
  });

  it("mail non classificabile -> ignored", async () => {
    const src = buildMime({ tipo: "posta-certificata" });
    const r = await ingestReceipt(await classifyReceipt(src), src);
    expect(r.status).toBe("ignored");
  });
});
