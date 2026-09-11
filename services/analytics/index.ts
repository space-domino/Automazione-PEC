import { db } from "@/lib/db";
import { aiCostSummary } from "@/services/ai-gateway";

/**
 * Analytics d'insieme della pipeline (sezione 28 / M12).
 * Aggrega import → scoperta → acquisto → offerta → PEC → vendita → trasferimento.
 * Query di sola lettura, pensate per una dashboard con refresh ~1 min.
 */

export interface DashboardFunnel {
  companies: number;
  domainsAnalyzed: number;
  domainsAvailable: number;
  domainsPurchased: number;
  offersPublished: number;
  pecSent: number;
  pecDelivered: number;
  ordersPaid: number;
  transferred: number;
}

export interface PecStats {
  draft: number;
  approved: number;
  sent: number;
  accepted: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  failureRate: number;
}

export interface SalesStats {
  ordersTotal: number;
  byStatus: Record<string, number>;
  revenueTotalEur: number;
  revenue30dEur: number;
  revenue7dEur: number;
  avgOrderValueEur: number;
}

export interface TransferStats {
  toStart: number;
  inProgress: number;
  failed: number;
  done: number;
}

export interface Dashboard {
  funnel: DashboardFunnel;
  pec: PecStats;
  sales: SalesStats;
  transfers: TransferStats;
  ai: Awaited<ReturnType<typeof aiCostSummary>>;
  generatedAt: string;
}

const SENT_STATES = ["SENT", "ACCEPTED", "DELIVERED"] as const;

export async function getDashboard(): Promise<Dashboard> {
  const now = Date.now();
  const d30 = new Date(now - 30 * 86_400_000);
  const d7 = new Date(now - 7 * 86_400_000);

  // in sequenza, non Promise.all: query concorrenti sulla stessa connessione
  // Postgres qui corrompono in modo intermittente il protocollo (vedi
  // services/catalog/companies.ts per il dettaglio).
  const companies = await db.company.count({ where: { deletedAt: null } });
  const domainsAnalyzed = await db.domain.count({
    where: { deletedAt: null, aiScore: { not: null } },
  });
  const domainsAvailable = await db.domain.count({
    where: { deletedAt: null, availabilityResult: "AVAILABLE" },
  });
  const domainsPurchased = await db.domain.count({
    where: { deletedAt: null, purchasedAt: { not: null } },
  });
  const offersPublished = await db.offer.count({
    where: { deletedAt: null, status: "PUBLISHED" },
  });
  const pecByStatus = await db.communication.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const pecSent = await db.communication.count({ where: { status: { in: [...SENT_STATES] } } });
  const ordersPaid = await db.order.count({ where: { paymentStatus: "SUCCEEDED" } });
  const domainsTransferred = await db.domain.count({
    where: { deletedAt: null, status: "TRANSFERRED" },
  });
  const ordersByStatus = await db.order.groupBy({
    by: ["orderStatus"],
    _count: { _all: true },
  });
  const revTotal = await db.order.aggregate({
    _sum: { amount: true },
    _avg: { amount: true },
    _count: { _all: true },
    where: { paymentStatus: "SUCCEEDED" },
  });
  const rev30 = await db.order.aggregate({
    _sum: { amount: true },
    where: { paymentStatus: "SUCCEEDED", paidAt: { gte: d30 } },
  });
  const rev7 = await db.order.aggregate({
    _sum: { amount: true },
    where: { paymentStatus: "SUCCEEDED", paidAt: { gte: d7 } },
  });
  const trToStart = await db.order.count({
    where: { orderStatus: "PAID", domain: { status: "SOLD" } },
  });
  const trInProgress = await db.order.count({
    where: { orderStatus: "FULFILLMENT_PENDING", domain: { status: "TRANSFER_PENDING" } },
  });
  const trFailed = await db.order.count({ where: { domain: { status: "TRANSFER_FAILED" } } });
  const trDone = await db.order.count({
    where: { orderStatus: { in: ["TRANSFERRED", "COMPLETED"] } },
  });
  const ai = await aiCostSummary();

  const pc = (s: string) => pecByStatus.find((r) => r.status === s)?._count._all ?? 0;
  const delivered = pc("DELIVERED");
  const failed = pc("FAILED") + pc("BOUNCED");

  const pec: PecStats = {
    draft: pc("DRAFT"),
    approved: pc("APPROVED"),
    sent: pecSent,
    accepted: pc("ACCEPTED"),
    delivered,
    failed,
    deliveryRate: pecSent > 0 ? delivered / pecSent : 0,
    failureRate: pecSent + failed > 0 ? failed / (pecSent + failed) : 0,
  };

  const byStatus: Record<string, number> = {};
  for (const r of ordersByStatus) byStatus[r.orderStatus] = r._count._all;

  const sales: SalesStats = {
    ordersTotal: revTotal._count._all,
    byStatus,
    revenueTotalEur: Number(revTotal._sum.amount ?? 0),
    revenue30dEur: Number(rev30._sum.amount ?? 0),
    revenue7dEur: Number(rev7._sum.amount ?? 0),
    avgOrderValueEur: Number(revTotal._avg.amount ?? 0),
  };

  return {
    funnel: {
      companies,
      domainsAnalyzed,
      domainsAvailable,
      domainsPurchased,
      offersPublished,
      pecSent,
      pecDelivered: delivered,
      ordersPaid,
      transferred: domainsTransferred,
    },
    pec,
    sales,
    transfers: { toStart: trToStart, inProgress: trInProgress, failed: trFailed, done: trDone },
    ai,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  Serie temporali della pipeline
// ---------------------------------------------------------------------------

export interface FunnelPoint {
  date: string;
  companies: number;
  domains: number;
  offersPublished: number;
  pecSent: number;
  pecDelivered: number;
  orders: number;
  revenue: number;
  transferred: number;
}

type RawRow = { d: Date; n: number };
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
function toMap(rows: RawRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(dayKey(new Date(r.d)), Number(r.n));
  return m;
}

export async function getFunnelTimeseries(days = 30): Promise<FunnelPoint[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const companies = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"createdAt")::date AS d, COUNT(*)::int AS n
        FROM "Company" WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL GROUP BY 1`;
  const domains = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"createdAt")::date AS d, COUNT(*)::int AS n
        FROM "Domain" WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL GROUP BY 1`;
  const offers = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"publishedAt")::date AS d, COUNT(*)::int AS n
        FROM "Offer" WHERE "publishedAt" >= ${since} GROUP BY 1`;
  const pecSent = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"sentAt")::date AS d, COUNT(*)::int AS n
        FROM "Communication" WHERE "sentAt" >= ${since} GROUP BY 1`;
  const pecDelivered = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"receivedAt")::date AS d, COUNT(*)::int AS n
        FROM "PecReceipt" WHERE "receivedAt" >= ${since} AND "type" = 'DELIVERY' GROUP BY 1`;
  const orders = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"createdAt")::date AS d, COUNT(*)::int AS n
        FROM "Order" WHERE "createdAt" >= ${since} GROUP BY 1`;
  const revenue = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"paidAt")::date AS d, COALESCE(SUM("amount"),0)::float AS n
        FROM "Order" WHERE "paidAt" >= ${since} AND "paymentStatus" = 'SUCCEEDED' GROUP BY 1`;
  const transferred = await db.$queryRaw<
    RawRow[]
  >`SELECT date_trunc('day',"transferCompletedAt")::date AS d, COUNT(*)::int AS n
        FROM "Order" WHERE "transferCompletedAt" >= ${since} GROUP BY 1`;

  const maps = {
    companies: toMap(companies),
    domains: toMap(domains),
    offers: toMap(offers),
    pecSent: toMap(pecSent),
    pecDelivered: toMap(pecDelivered),
    orders: toMap(orders),
    revenue: toMap(revenue),
    transferred: toMap(transferred),
  };

  const out: FunnelPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const k = dayKey(d);
    out.push({
      date: k,
      companies: maps.companies.get(k) ?? 0,
      domains: maps.domains.get(k) ?? 0,
      offersPublished: maps.offers.get(k) ?? 0,
      pecSent: maps.pecSent.get(k) ?? 0,
      pecDelivered: maps.pecDelivered.get(k) ?? 0,
      orders: maps.orders.get(k) ?? 0,
      revenue: maps.revenue.get(k) ?? 0,
      transferred: maps.transferred.get(k) ?? 0,
    });
  }
  return out;
}
