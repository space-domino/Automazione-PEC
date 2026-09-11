import { db } from "@/lib/db";

export interface Overview {
  companiesImported: number;
  domainsAnalyzed: number;
  domainsAvailable: number;
  domainsPurchased: number;
  offersPublished: number;
  pecSent: number;
  landingViews: number;
  orders: number;
  ordersPaid: number;
  revenueEur: number;
  /** ordini pagati / PEC inviate */
  conversionRate: number;
}

export async function getOverview(): Promise<Overview> {
  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const companiesImported = await db.company.count({ where: { deletedAt: null } });
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
  const pecSent = await db.communication.count({
    where: { status: { in: ["SENT", "ACCEPTED", "DELIVERED"] } },
  });
  const landingViews = await db.landingPageView.count();
  const orders = await db.order.count();
  const ordersPaid = await db.order.count({ where: { paymentStatus: "SUCCEEDED" } });
  const revenueAgg = await db.order.aggregate({
    _sum: { amount: true },
    where: { paymentStatus: "SUCCEEDED" },
  });

  return {
    companiesImported,
    domainsAnalyzed,
    domainsAvailable,
    domainsPurchased,
    offersPublished,
    pecSent,
    landingViews,
    orders,
    ordersPaid,
    revenueEur: Number(revenueAgg._sum.amount ?? 0),
    conversionRate: pecSent > 0 ? ordersPaid / pecSent : 0,
  };
}
