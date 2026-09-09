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
  const [
    companiesImported,
    domainsAnalyzed,
    domainsAvailable,
    domainsPurchased,
    offersPublished,
    pecSent,
    landingViews,
    orders,
    ordersPaid,
    revenueAgg,
  ] = await Promise.all([
    db.company.count({ where: { deletedAt: null } }),
    db.domain.count({ where: { deletedAt: null, aiScore: { not: null } } }),
    db.domain.count({ where: { deletedAt: null, availabilityResult: "AVAILABLE" } }),
    db.domain.count({ where: { deletedAt: null, purchasedAt: { not: null } } }),
    db.offer.count({ where: { deletedAt: null, status: "PUBLISHED" } }),
    db.communication.count({ where: { status: { in: ["SENT", "ACCEPTED", "DELIVERED"] } } }),
    db.landingPageView.count(),
    db.order.count(),
    db.order.count({ where: { paymentStatus: "SUCCEEDED" } }),
    db.order.aggregate({ _sum: { amount: true }, where: { paymentStatus: "SUCCEEDED" } }),
  ]);

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
