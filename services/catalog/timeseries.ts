import { db } from "@/lib/db";

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  companies: number;
  domains: number;
  pecSent: number;
  views: number;
  orders: number;
  revenue: number;
}

type Row = { d: Date; n: number };

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function toMap(rows: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(dayKey(new Date(r.d)), Number(r.n));
  return m;
}

/** Serie giornaliere degli ultimi `days` giorni per i grafici Overview. */
export async function getTimeseries(days = 14): Promise<TimeseriesPoint[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const [companies, domains, pec, views, orders, revenue] = await Promise.all([
    db.$queryRaw<Row[]>`SELECT date_trunc('day', "createdAt")::date AS d, COUNT(*)::int AS n
      FROM "Company" WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Row[]>`SELECT date_trunc('day', "createdAt")::date AS d, COUNT(*)::int AS n
      FROM "Domain" WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Row[]>`SELECT date_trunc('day', "sentAt")::date AS d, COUNT(*)::int AS n
      FROM "Communication" WHERE "sentAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Row[]>`SELECT date_trunc('day', "viewedAt")::date AS d, COUNT(*)::int AS n
      FROM "LandingPageView" WHERE "viewedAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Row[]>`SELECT date_trunc('day', "createdAt")::date AS d, COUNT(*)::int AS n
      FROM "Order" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<
      Row[]
    >`SELECT date_trunc('day', "paidAt")::date AS d, COALESCE(SUM("amount"),0)::float AS n
      FROM "Order" WHERE "paidAt" >= ${since} AND "paymentStatus" = 'SUCCEEDED' GROUP BY 1 ORDER BY 1`,
  ]);

  const mC = toMap(companies);
  const mD = toMap(domains);
  const mP = toMap(pec);
  const mV = toMap(views);
  const mO = toMap(orders);
  const mR = toMap(revenue);

  const out: TimeseriesPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const k = dayKey(d);
    out.push({
      date: k,
      companies: mC.get(k) ?? 0,
      domains: mD.get(k) ?? 0,
      pecSent: mP.get(k) ?? 0,
      views: mV.get(k) ?? 0,
      orders: mO.get(k) ?? 0,
      revenue: mR.get(k) ?? 0,
    });
  }
  return out;
}
