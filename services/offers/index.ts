import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { QUEUE_NAMES, enqueue } from "@/lib/queue";
import { slugify } from "@/lib/text";
import {
  domainStateConfig,
  offerStateConfig,
  transition,
  writeAudit,
} from "@/services/state-machine";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export interface Actor {
  userId?: string;
  requestId?: string;
}

/** URL della landing sullo storefront a partire dallo slug (`fqdn` con "." -> "-"). */
export function landingUrlForSlug(slug: string): string {
  return `${env.SPACEDOMINO_BASE_URL.replace(/\/+$/, "")}/domini/${slug}`;
}

// ---------------------------------------------------------------------------
//  Schemi input
// ---------------------------------------------------------------------------

const contentFields = {
  title: z.string().trim().min(1).max(160).optional(),
  headline: z.string().trim().max(300).optional(),
  bodyHtml: z.string().max(50_000).optional(),
  metaTitle: z.string().trim().max(160).optional(),
  metaDescription: z.string().trim().max(320).optional(),
};

export const createOfferSchema = z.object({
  sellingPrice: z.coerce.number().positive().max(1_000_000).optional(),
  ...contentFields,
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const updateOfferSchema = z
  .object({
    price: z.coerce.number().positive().max(1_000_000).optional(),
    ...contentFields,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Nessun campo da aggiornare",
  });
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

// ---------------------------------------------------------------------------
//  Query
// ---------------------------------------------------------------------------

const OFFER_INCLUDE = {
  domain: { select: { id: true, fqdn: true, sld: true, extension: true, status: true } },
  company: { select: { id: true, legalName: true } },
} satisfies Prisma.OfferInclude;

export interface OfferListParams {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listOffers(p: OfferListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));

  const where: Prisma.OfferWhereInput = { deletedAt: null };
  if (p.status) where.status = p.status as Prisma.OfferWhereInput["status"];
  if (p.q) {
    where.OR = [
      { title: { contains: p.q, mode: "insensitive" } },
      { slug: { contains: slugify(p.q) } },
      { domain: { fqdn: { contains: p.q.toLowerCase() } } },
    ];
  }

  const [data, total] = await Promise.all([
    db.offer.findMany({
      where,
      include: OFFER_INCLUDE,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.offer.count({ where }),
  ]);

  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getOffer(id: string) {
  const offer = await db.offer.findFirst({
    where: { id, deletedAt: null },
    include: OFFER_INCLUDE,
  });
  if (!offer) throw new NotFoundError("Offerta inesistente");
  return offer;
}

export async function getOfferBySlug(slug: string) {
  return db.offer.findFirst({ where: { slug, deletedAt: null }, include: OFFER_INCLUDE });
}

// ---------------------------------------------------------------------------
//  Ciclo di vita
// ---------------------------------------------------------------------------

/**
 * Crea l'offerta per un dominio acquistato (sezione H).
 * Precondizioni: Domain in PURCHASED (o OFFER_DRAFT senza offerta, per riprendere
 * un run interrotto), prezzo di vendita noto, nessuna offerta già collegata.
 */
export async function createOffer(domainId: string, input: CreateOfferInput, actor: Actor) {
  const domain = await db.domain.findUnique({
    where: { id: domainId },
    include: { offer: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!domain || domain.deletedAt) throw new NotFoundError("Dominio inesistente");
  if (domain.offer) throw new ConflictError("OFFER_EXISTS", "Il dominio ha già un'offerta");
  if (domain.status !== "PURCHASED" && domain.status !== "OFFER_DRAFT") {
    throw new ConflictError("BAD_STATE", `Offerta non creabile in stato ${domain.status}`);
  }

  const price = input.sellingPrice ?? (domain.sellingPrice ? Number(domain.sellingPrice) : null);
  if (price == null || price <= 0) {
    throw new ValidationError(undefined, "Imposta un prezzo di vendita valido");
  }

  const slug = slugify(domain.fqdn);
  const landingPageUrl = landingUrlForSlug(slug);

  // 1) allinea il prezzo sul Domain (serve alla guardia OFFER_DRAFT)
  if (input.sellingPrice != null && Number(domain.sellingPrice ?? 0) !== input.sellingPrice) {
    await db.domain.update({ where: { id: domainId }, data: { sellingPrice: input.sellingPrice } });
  }

  // 2) porta il Domain in OFFER_DRAFT (se non lo è già)
  if (domain.status === "PURCHASED") {
    await transition(domainStateConfig, domainId, "OFFER_DRAFT", {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: "creazione offerta",
    });
  }

  // 3) crea l'Offer in DRAFT
  const offer = await db.offer.create({
    data: {
      companyId: domain.companyId,
      domainId,
      slug,
      title: input.title ?? domain.fqdn,
      headline: input.headline ?? null,
      bodyHtml: input.bodyHtml ?? null,
      price,
      currency: "EUR",
      landingPageUrl,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      status: "DRAFT",
      createdByUserId: actor.userId ?? null,
    },
    include: OFFER_INCLUDE,
  });

  await writeAudit(db, {
    action: "offer.create",
    entityType: "Offer",
    entityId: offer.id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    after: { slug, price, status: "DRAFT" },
    summary: `Offerta creata per ${domain.fqdn}`,
  });

  return offer;
}

/** PATCH contenuti/prezzo dell'offerta (consentito in ogni stato tranne SOLD). */
export async function updateOfferContent(offerId: string, patch: UpdateOfferInput, actor: Actor) {
  const offer = await db.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    include: { domain: { select: { id: true, sld: true, extension: true } } },
  });
  if (!offer) throw new NotFoundError("Offerta inesistente");
  if (offer.status === "SOLD")
    throw new ConflictError("BAD_STATE", "Offerta venduta, non modificabile");

  const data: Prisma.OfferUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.headline !== undefined) data.headline = patch.headline;
  if (patch.bodyHtml !== undefined) data.bodyHtml = patch.bodyHtml;
  if (patch.metaTitle !== undefined) data.metaTitle = patch.metaTitle;
  if (patch.metaDescription !== undefined) data.metaDescription = patch.metaDescription;

  const priceChanged = patch.price !== undefined && Number(offer.price) !== patch.price;
  if (patch.price !== undefined) data.price = patch.price;

  const updated = await db.offer.update({ where: { id: offerId }, data, include: OFFER_INCLUDE });

  if (priceChanged) {
    await db.domain.update({
      where: { id: offer.domainId },
      data: { sellingPrice: patch.price },
    });
  }

  await writeAudit(db, {
    action: "offer.update",
    entityType: "Offer",
    entityId: offerId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    before: { price: Number(offer.price) },
    after: { price: Number(updated.price) },
  });

  // se è pubblicata e cambia il prezzo, ripropaga al catalogo dello storefront
  if (priceChanged && updated.status === "PUBLISHED") {
    await enqueueStorefront(
      "push",
      updated.id,
      offer.domain.sld,
      offer.domain.extension,
      Number(updated.price),
    );
  }

  return updated;
}

/** DRAFT|PAUSED -> PUBLISHED. Pubblica il dominio anche sullo storefront. */
export async function publishOffer(offerId: string, actor: Actor) {
  const offer = await loadForLifecycle(offerId);
  if (offer.status !== "DRAFT" && offer.status !== "PAUSED") {
    throw new ConflictError("BAD_STATE", `Pubblicabile solo da DRAFT/PAUSED (ora ${offer.status})`);
  }

  await transition(
    offerStateConfig,
    offerId,
    "PUBLISHED",
    {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: "pubblicazione offerta",
    },
    { publishedAt: new Date() },
  );

  if (offer.domain.status === "OFFER_DRAFT") {
    await transition(domainStateConfig, offer.domainId, "OFFER_PUBLISHED", {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: "offerta pubblicata",
    });
  }

  await enqueueStorefront(
    "push",
    offerId,
    offer.domain.sld,
    offer.domain.extension,
    Number(offer.price),
  );

  return getOffer(offerId);
}

/** PUBLISHED -> PAUSED. Toglie il dominio dal catalogo storefront (il Domain resta OFFER_PUBLISHED). */
export async function pauseOffer(offerId: string, reason: string, actor: Actor) {
  const offer = await loadForLifecycle(offerId);
  await transition(offerStateConfig, offerId, "PAUSED", {
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason: reason?.trim() || "offerta in pausa",
  });
  await enqueueStorefront("remove", offerId, offer.domain.sld, offer.domain.extension);
  return getOffer(offerId);
}

/** Qualsiasi stato -> WITHDRAWN. Riporta il Domain a OFFER_DRAFT e pulisce lo storefront. */
export async function withdrawOffer(offerId: string, reason: string, actor: Actor) {
  const offer = await loadForLifecycle(offerId);
  if (offer.status === "SOLD") {
    throw new ConflictError("BAD_STATE", "Offerta venduta: non ritirabile");
  }

  await transition(
    offerStateConfig,
    offerId,
    "WITHDRAWN",
    {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: reason?.trim() || "offerta ritirata",
    },
    { withdrawnAt: new Date() },
  );

  if (offer.domain.status === "OFFER_PUBLISHED") {
    await transition(domainStateConfig, offer.domainId, "OFFER_DRAFT", {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: "offerta ritirata",
    });
  }

  await enqueueStorefront("remove", offerId, offer.domain.sld, offer.domain.extension);
  return getOffer(offerId);
}

/** WITHDRAWN -> DRAFT: rimette in lavorazione un'offerta ritirata. */
export async function reviveOffer(offerId: string, actor: Actor) {
  await loadForLifecycle(offerId);
  await transition(offerStateConfig, offerId, "DRAFT", {
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason: "offerta riaperta",
  });
  return getOffer(offerId);
}

// ---------------------------------------------------------------------------
//  Interni
// ---------------------------------------------------------------------------

async function loadForLifecycle(offerId: string) {
  const offer = await db.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    include: { domain: { select: { id: true, status: true, sld: true, extension: true } } },
  });
  if (!offer) throw new NotFoundError("Offerta inesistente");
  return offer;
}

function enqueueStorefront(
  op: "push" | "remove",
  offerId: string,
  sld: string,
  tld: string,
  price?: number,
) {
  return enqueue(
    QUEUE_NAMES.storefront,
    `storefront.${op}`,
    { offerId, sld, tld, price },
    { dedupeKey: `sf:${op}:${offerId}:${Date.now()}` },
  );
}
