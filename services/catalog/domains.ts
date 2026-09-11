import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface DomainListParams {
  group?: string;
  extension?: string;
  companyId?: string;
  minRank?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const DOMAIN_GROUPS: Record<string, { label: string; where: Prisma.DomainWhereInput }> = {
  all: { label: "Tutti", where: {} },
  discovered: { label: "Da verificare", where: { status: "DISCOVERED" } },
  available: { label: "Disponibili", where: { availabilityResult: "AVAILABLE" } },
  registered: { label: "Registrati", where: { availabilityResult: "REGISTERED" } },
  unknown: {
    label: "Sconosciuti / errore",
    where: { availabilityResult: { in: ["UNKNOWN", "ERROR"] } },
  },
  purchased: { label: "Acquistati", where: { purchasedAt: { not: null } } },
  for_sale: { label: "In vendita", where: { status: { in: ["OFFER_DRAFT", "OFFER_PUBLISHED"] } } },
  sold: {
    label: "Venduti",
    where: { status: { in: ["PAID", "SOLD", "TRANSFER_PENDING", "TRANSFERRED"] } },
  },
};

export async function listDomains(p: DomainListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 100));
  const groupKey = p.group && DOMAIN_GROUPS[p.group] ? p.group : "all";

  const where: Prisma.DomainWhereInput = { deletedAt: null, ...DOMAIN_GROUPS[groupKey]?.where };
  if (p.extension) where.extension = p.extension.toLowerCase();
  if (p.companyId) where.companyId = p.companyId;
  if (typeof p.minRank === "number") where.rankScore = { gte: p.minRank };
  if (p.q) where.fqdn = { contains: p.q.toLowerCase() };

  // in sequenza, non Promise.all: query concorrenti sulla stessa connessione
  // Postgres qui corrompono in modo intermittente il protocollo (vedi companies.ts).
  const rows = await db.domain.findMany({
    where,
    include: { company: { select: { id: true, legalName: true } } },
    orderBy: [{ rankScore: "desc" }, { aiScore: "desc" }, { createdAt: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const total = await db.domain.count({ where });
  const groupCounts = await db.domain.groupBy({
    by: ["availabilityResult"],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  return {
    data: rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    groupKey,
    availabilityCounts: Object.fromEntries(
      groupCounts.map((g) => [g.availabilityResult, g._count._all]),
    ) as Record<string, number>,
  };
}

export async function getDomainDetail(id: string) {
  const domain = await db.domain.findUnique({
    where: { id },
    include: {
      company: true,
      availabilityChecks: { orderBy: { checkedAt: "desc" }, take: 10 },
      offer: {
        include: { communications: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
      orders: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!domain) return null;

  const transitions = await db.stateTransition.findMany({
    where: { entityType: "Domain", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return { domain, transitions };
}
