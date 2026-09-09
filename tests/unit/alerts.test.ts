import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    notification: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { store, riskChecks: vi.fn(), systemHealth: vi.fn(), fetchMock: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db: h.store }));
vi.mock("@/services/monitoring/health", () => ({
  riskChecks: h.riskChecks,
  systemHealth: h.systemHealth,
}));

import { raiseAlert, scanForAlerts } from "@/services/monitoring/alerts";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetchMock);
  m(store.notification.findFirst).mockResolvedValue(null);
  m(store.notification.create).mockImplementation((a: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "n1", createdAt: new Date(), ...a.data }),
  );
});

describe("raiseAlert", () => {
  it("crea la notifica e (senza n8n) non chiama fetch", async () => {
    const r = await raiseAlert({
      type: "risk.pec_stuck",
      title: "3 PEC ferme",
      dedupeKey: "pec_stuck",
    });
    expect(r.created).toBe(true);
    expect(store.notification.create).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).not.toHaveBeenCalled();
    const data = m(store.notification.create).mock.calls[0][0].data;
    expect(data.data).toMatchObject({ dedupeKey: "pec_stuck" });
  });

  it("deduplica: se esiste una notifica non letta con stessa chiave, non ne crea un'altra", async () => {
    m(store.notification.findFirst).mockResolvedValue({ id: "existing" });
    const r = await raiseAlert({ type: "risk.pec_stuck", title: "x", dedupeKey: "pec_stuck" });
    expect(r).toEqual({ created: false, notificationId: "existing" });
    expect(store.notification.create).not.toHaveBeenCalled();
  });
});

describe("scanForAlerts", () => {
  it("alza un alert per ogni check non-ok (rischio + infrastruttura)", async () => {
    m(h.riskChecks).mockResolvedValue([
      { name: "pec_stuck", status: "warn", detail: "3 PEC" },
      { name: "jobs_failed_24h", status: "ok" },
    ]);
    m(h.systemHealth).mockResolvedValue({
      status: "degraded",
      checks: [
        { name: "database", status: "ok" },
        { name: "worker", status: "down", detail: "nessun heartbeat" },
        { name: "storefront", status: "warn" },
      ],
    });

    const r = await scanForAlerts();
    expect(r.raised).toBe(2); // pec_stuck + infra.worker (storefront non è nella lista infra)
    expect(r.health).toBe("degraded");
    expect(store.notification.create).toHaveBeenCalledTimes(2);
  });
});
