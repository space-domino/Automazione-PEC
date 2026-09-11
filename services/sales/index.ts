import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { type SpacedominoSaleRow, fetchCompletedSales } from "@/services/spacedomino";
import {
  type TransitionCtx,
  domainStateConfig,
  offerStateConfig,
  transition,
  writeAudit,
} from "@/services/state-machine";
import type { DomainStatus, OfferStatus, Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Bridge vendite (sezione M8).
 *
 * Il pagamento avviene interamente sullo storefront spacedomino.it (Stripe loro):
 * il cliente clicca il link nella PEC, apre la pagina prodotto, aggiunge al
 * carrello e paga. La piattaforma NON tocca Stripe: rileva l'acquisto leggendo
 * `orders`/`order_items` dello storefront, lo abbina a un'`Offer` pubblicata,
 * avanza la macchina a stati fino a `SOLD` e registra un `Order` interno con i
 * dati cliente per il workflow di trasferimento (M11).
 *
 * Idempotente: chiave `(externalOrderNumber, domainId)` + vincolo `Order.offerId`.
 */

const log = logger.child({ svc: "sales" });

export interface Actor {
  userId?: string;
  requestId?: string;
}

// --- percorsi verso SOLD -----------------------------------------------------

/** Passo successivo del Domain verso SOLD (sezione E.2). */
const DOMAIN_STEP_TO_SOLD: Partial<Record<DomainStatus, DomainStatus>> = {
  OFFER_DRAFT: "OFFER_PUBLISHED",
  PEC_DRAFT: "OFFER_PUBLISHED",
  PEC_APPROVED: "OFFER_PUBLISHED",
  PEC_SENT: "CHECKOUT_STARTED",
  CUSTOMER_INTERESTED: "CHECKOUT_STARTED",
  OFFER_PUBLISHED: "CHECKOUT_STARTED",
  CHECKOUT_STARTED: "PAID",
  PAID: "SOLD",
};

/** Passo successivo dell'Offer verso SOLD (sezione E.3). */
const OFFER_STEP_TO_SOLD: Partial<Record<OfferStatus, OfferStatus>> = {
  WITHDRAWN: "DRAFT",
  DRAFT: "PUBLISHED",
  PAUSED: "PUBLISHED",
  PUBLISHED: "SOLD",
};

const DOMAIN_ALREADY_SOLD = new Set<DomainStatus>([
  "SOLD",
  "TRANSFER_PENDING",
  "TRANSFERRED",
  "TRANSFER_FAILED",
]);

type StepCtx = TransitionCtx;

async function advanceDomainToSold(domainId: string, ctx: StepCtx): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const d = await db.domain.findUnique({ where: { id: domainId }, select: { status: true } });
    if (!d) throw new NotFoundError("Dominio inesistente");
    if (d.status === "SOLD" || DOMAIN_ALREADY_SOLD.has(d.status)) return;
    const next = DOMAIN_STEP_TO_SOLD[d.status];
    if (!next) throw new ConflictError("BAD_STATE", `Vendita non applicabile da stato ${d.status}`);
    await transition(domainStateConfig, domainId, next, ctx);
  }
  throw new ConflictError("BAD_STATE", "Impossibile portare il dominio a SOLD");
}

async function advanceOfferToSold(offerId: string, ctx: StepCtx): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const o = await db.offer.findUnique({ where: { id: offerId }, select: { status: true } });
    if (!o) throw new NotFoundError("Offerta inesistente");
    if (o.status === "SOLD") return;
    const next = OFFER_STEP_TO_SOLD[o.status];
    if (!next) throw new ConflictError("BAD_STATE", `Offerta in stato ${o.status}: non vendibile`);
    await transition(offerStateConfig, offerId, next, ctx);
  }
  throw new ConflictError("BAD_STATE", "Impossibile portare l'offerta a SOLD");
}

// --- ingest da spacedomino -------------------------------------------------

export interface SaleIngestResult {
  status: "sold" | "already" | "unmatched";
  fqdn: string;
  orderId?: string;
  domainId?: string;
}

/** Registra UNA riga d'ordine pagata dello storefront. Idempotente. */
export async function ingestExternalSale(
  row: SpacedominoSaleRow,
  actor: Actor,
): Promise<SaleIngestResult> {
  const tld = row.tld.replace(/^\.+/, "").toLowerCase();
  const fqdn = `${row.sld}.${tld}`;

  const domain = await db.domain.findUnique({ where: { fqdn }, include: { offer: true } });
  if (!domain || domain.deletedAt || !domain.offer) {
    return { status: "unmatched", fqdn };
  }
  const offer = domain.offer;

  const existing = await db.order.findFirst({
    where: {
      OR: [{ externalOrderNumber: row.orderNumber, domainId: domain.id }, { offerId: offer.id }],
    },
    select: { id: true },
  });
  if (existing) return { status: "already", fqdn, orderId: existing.id, domainId: domain.id };

  const ctx: StepCtx = {
    actorType: "SYSTEM",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason: `vendita storefront ordine ${row.orderNumber}`,
    metadata: { source: "spacedomino", orderNumber: row.orderNumber },
  };

  await advanceOfferToSold(offer.id, ctx);
  await advanceDomainToSold(domain.id, ctx);

  const paidAt = row.paidAt ?? row.completedAt ?? new Date();
  const amount = row.price > 0 ? row.price : Number(offer.price);

  const order = await db.order.create({
    data: {
      offerId: offer.id,
      companyId: domain.companyId,
      domainId: domain.id,
      source: "SPACEDOMINO",
      externalOrderNumber: row.orderNumber,
      externalRef: row.paymentRef,
      customerEmail: row.email,
      customerData: {
        name: row.customerName,
        email: row.email,
        years: row.years,
        orderNumber: row.orderNumber,
        paymentRef: row.paymentRef,
        orderStatus: row.orderStatus,
        itemStatus: row.itemStatus,
      } as Prisma.InputJsonValue,
      amount,
      currency: "EUR",
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      paidAt,
    },
  });

  await writeAudit(db, {
    action: "sale.ingested.spacedomino",
    entityType: "Order",
    entityId: order.id,
    actorType: "SYSTEM",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    after: { fqdn, orderNumber: row.orderNumber, amount, email: row.email },
    summary: `Vendita da spacedomino: ${fqdn} (ordine ${row.orderNumber})`,
  });

  log.info({ fqdn, orderNumber: row.orderNumber, orderId: order.id }, "vendita ingerita");
  return { status: "sold", fqdn, orderId: order.id, domainId: domain.id };
}

export const syncSalesSchema = z.object({
  sinceDays: z.coerce.number().int().min(1).max(365).default(90),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type SyncSalesInput = z.infer<typeof syncSalesSchema>;

export interface SyncSalesResult {
  skipped?: "storefront-disabled";
  scanned: number;
  sold: number;
  already: number;
  unmatched: number;
  failed: number;
  soldFqdns: string[];
}

/** Scansiona le vendite recenti dello storefront e ne ingerisce quelle nostre. */
export async function syncExternalSales(
  input: Partial<SyncSalesInput>,
  actor: Actor,
): Promise<SyncSalesResult> {
  const base: SyncSalesResult = {
    scanned: 0,
    sold: 0,
    already: 0,
    unmatched: 0,
    failed: 0,
    soldFqdns: [],
  };
  if (!features.storefront) return { ...base, skipped: "storefront-disabled" };

  const { sinceDays, limit } = syncSalesSchema.parse(input ?? {});
  const rows = await fetchCompletedSales({ sinceDays, limit });
  base.scanned = rows.length;

  for (const row of rows) {
    try {
      const r = await ingestExternalSale(row, actor);
      if (r.status === "sold") {
        base.sold++;
        base.soldFqdns.push(r.fqdn);
      } else if (r.status === "already") {
        base.already++;
      } else {
        base.unmatched++;
      }
    } catch (err) {
      base.failed++;
      log.warn(
        { err, orderNumber: row.orderNumber, sld: row.sld, tld: row.tld },
        "ingest vendita fallito",
      );
    }
  }

  log.info(base, "sync vendite storefront completato");
  return base;
}

// --- registrazione manuale ------------------------------------------------

export const manualSaleSchema = z
  .object({
    offerId: z.string().min(1).optional(),
    domainId: z.string().min(1).optional(),
    fqdn: z.string().trim().toLowerCase().min(3).optional(),
    customerEmail: z.string().email(),
    customerName: z.string().trim().max(200).optional(),
    customerVat: z.string().trim().max(32).optional(),
    amount: z.coerce.number().positive().max(1_000_000).optional(),
    orderNumber: z.string().trim().max(64).optional(),
    paymentRef: z.string().trim().max(128).optional(),
    paidAt: z.coerce.date().optional(),
  })
  .refine((v) => v.offerId || v.domainId || v.fqdn, {
    message: "Indica offerId, domainId o fqdn",
  });
export type ManualSaleInput = z.infer<typeof manualSaleSchema>;

async function resolveOfferForSale(input: ManualSaleInput) {
  if (input.offerId) {
    const o = await db.offer.findFirst({
      where: { id: input.offerId, deletedAt: null },
      include: { domain: true },
    });
    if (!o) throw new NotFoundError("Offerta inesistente");
    return o;
  }
  const where = input.domainId ? { id: input.domainId } : { fqdn: input.fqdn };
  const domain = await db.domain.findUnique({ where, include: { offer: true } });
  if (!domain || domain.deletedAt) throw new NotFoundError("Dominio inesistente");
  if (!domain.offer) throw new ConflictError("NO_OFFER", "Il dominio non ha un'offerta");
  return { ...domain.offer, domain };
}

/** Registra una vendita a mano (storefront non collegato, o caso fuori flusso). */
export async function recordManualSale(input: ManualSaleInput, actor: Actor) {
  const offer = await resolveOfferForSale(input);

  const dup = await db.order.findUnique({ where: { offerId: offer.id }, select: { id: true } });
  if (dup) throw new ConflictError("ORDER_EXISTS", "L'offerta ha già un ordine registrato");

  const ctx: StepCtx = {
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason: input.orderNumber ? `vendita manuale ordine ${input.orderNumber}` : "vendita manuale",
    metadata: { source: "manual", orderNumber: input.orderNumber ?? null },
  };

  await advanceOfferToSold(offer.id, ctx);
  await advanceDomainToSold(offer.domainId, ctx);

  const amount = input.amount ?? Number(offer.price);
  const order = await db.order.create({
    data: {
      offerId: offer.id,
      companyId: offer.companyId,
      domainId: offer.domainId,
      source: "MANUAL",
      externalOrderNumber: input.orderNumber ?? null,
      externalRef: input.paymentRef ?? null,
      customerEmail: input.customerEmail,
      customerVat: input.customerVat ?? null,
      customerData: {
        name: input.customerName ?? null,
        email: input.customerEmail,
        vat: input.customerVat ?? null,
        orderNumber: input.orderNumber ?? null,
        paymentRef: input.paymentRef ?? null,
        source: "manual",
      } as Prisma.InputJsonValue,
      amount,
      currency: "EUR",
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      paidAt: input.paidAt ?? new Date(),
    },
  });

  await writeAudit(db, {
    action: "sale.recorded.manual",
    entityType: "Order",
    entityId: order.id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    after: { offerId: offer.id, amount, email: input.customerEmail },
    summary: `Vendita manuale registrata (offerta ${offer.slug})`,
  });

  return order;
}

// --- query ---------------------------------------------------------------

const ORDER_INCLUDE = {
  domain: { select: { id: true, fqdn: true, status: true } },
  offer: { select: { id: true, slug: true, title: true } },
  company: { select: { id: true, legalName: true } },
} satisfies Prisma.OrderInclude;

export interface OrderListParams {
  orderStatus?: string;
  source?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listOrders(p: OrderListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));

  const where: Prisma.OrderWhereInput = {};
  if (p.orderStatus) where.orderStatus = p.orderStatus as Prisma.OrderWhereInput["orderStatus"];
  if (p.source) where.source = p.source as Prisma.OrderWhereInput["source"];
  if (p.q) {
    const q = p.q.trim();
    where.OR = [
      { customerEmail: { contains: q, mode: "insensitive" } },
      { externalOrderNumber: { contains: q, mode: "insensitive" } },
      { domain: { fqdn: { contains: q.toLowerCase() } } },
    ];
  }

  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const data = await db.order.findMany({
    where,
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const total = await db.order.count({ where });
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getOrder(id: string) {
  const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) throw new NotFoundError("Ordine inesistente");
  return order;
}
