import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = {
    company: { count: vi.fn() },
    domain: { count: vi.fn() },
    offer: { count: vi.fn() },
    communication: { count: vi.fn(), groupBy: vi.fn() },
    order: { count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  };
  return { store, aiCostSummary: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db: h.store }));
vi.mock("@/services/ai-gateway", () => ({ aiCostSummary: h.aiCostSummary }));

import { getDashboard } from "@/services/analytics";

// biome-ignore lint/suspicious/noExplicitAny: helper mock
const m = (fn: unknown) => fn as any;
const { store } = h;

beforeEach(() => {
  vi.clearAllMocks();
  m(store.company.count).mockResolvedValue(50);
  m(store.domain.count).mockResolvedValue(12);
  m(store.offer.count).mockResolvedValue(8);
  m(store.communication.count).mockResolvedValue(9);
  m(store.communication.groupBy).mockResolvedValue([
    { status: "DRAFT", _count: { _all: 2 } },
    { status: "SENT", _count: { _all: 3 } },
    { status: "DELIVERED", _count: { _all: 5 } },
    { status: "FAILED", _count: { _all: 1 } },
  ]);
  m(store.order.count).mockResolvedValue(4);
  m(store.order.groupBy).mockResolvedValue([
    { orderStatus: "PAID", _count: { _all: 3 } },
    { orderStatus: "COMPLETED", _count: { _all: 1 } },
  ]);
  m(store.order.aggregate).mockResolvedValue({
    _sum: { amount: 1996 },
    _avg: { amount: 499 },
    _count: { _all: 4 },
  });
  m(h.aiCostSummary).mockResolvedValue({ totalCostUsd: 2.5, last24hCostUsd: 0.4 });
});

describe("getDashboard", () => {
  it("compone funnel, PEC, vendite, trasferimenti e AI", async () => {
    const d = await getDashboard();

    expect(d.pec.delivered).toBe(5);
    expect(d.pec.deliveryRate).toBeCloseTo(5 / 9);
    expect(d.pec.failed).toBe(1);

    expect(d.sales.revenueTotalEur).toBe(1996);
    expect(d.sales.avgOrderValueEur).toBe(499);
    expect(d.sales.byStatus).toMatchObject({ PAID: 3, COMPLETED: 1 });

    expect(d.funnel.companies).toBe(50);
    expect(d.funnel.offersPublished).toBe(8);
    expect(d.transfers).toHaveProperty("toStart");
    expect(d.ai).toMatchObject({ totalCostUsd: 2.5 });
    expect(typeof d.generatedAt).toBe("string");
  });
});
