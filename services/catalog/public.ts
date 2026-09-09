import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Vista pubblica del catalogo (M7): solo offerte PUBLISHED, campi sicuri.
 * Consumata dallo storefront spacedomino.it (e da eventuali landing esterne).
 * Nessun dato interno (prezzo d'acquisto, note, stato PEC, ...).
 */

export interface PublicOffer {
  slug: string;
  fqdn: string;
  sld: string;
  extension: string;
  title: string;
  headline: string | null;
  bodyHtml: string | null;
  price: number;
  currency: string;
  landingPageUrl: string;
  metaTitle: string | null;
  metaDescription: string | null;
  companyName: string;
  publishedAt: string | null;
}

const PUBLIC_SELECT = {
  slug: true,
  title: true,
  headline: true,
  bodyHtml: true,
  price: true,
  currency: true,
  landingPageUrl: true,
  metaTitle: true,
  metaDescription: true,
  publishedAt: true,
  domain: { select: { fqdn: true, sld: true, extension: true } },
  company: { select: { legalName: true } },
} satisfies Prisma.OfferSelect;

type Row = Prisma.OfferGetPayload<{ select: typeof PUBLIC_SELECT }>;

function toPublic(o: Row): PublicOffer {
  return {
    slug: o.slug,
    fqdn: o.domain.fqdn,
    sld: o.domain.sld,
    extension: o.domain.extension,
    title: o.title,
    headline: o.headline,
    bodyHtml: o.bodyHtml,
    price: Number(o.price),
    currency: o.currency,
    landingPageUrl: o.landingPageUrl,
    metaTitle: o.metaTitle,
    metaDescription: o.metaDescription,
    companyName: o.company.legalName,
    publishedAt: o.publishedAt ? o.publishedAt.toISOString() : null,
  };
}

export interface PublicListParams {
  q?: string;
  extension?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  pageSize?: number;
}

export async function listPublicOffers(p: PublicListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, p.pageSize ?? 24));

  const where: Prisma.OfferWhereInput = { status: "PUBLISHED", deletedAt: null };
  if (p.extension) where.domain = { extension: p.extension.replace(/^\.+/, "").toLowerCase() };
  if (p.q) {
    const q = p.q.trim().toLowerCase();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { domain: { fqdn: { contains: q } } },
    ];
  }
  if (p.minPrice != null || p.maxPrice != null) {
    where.price = {};
    if (p.minPrice != null) where.price.gte = p.minPrice;
    if (p.maxPrice != null) where.price.lte = p.maxPrice;
  }

  const [rows, total] = await Promise.all([
    db.offer.findMany({
      where,
      select: PUBLIC_SELECT,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.offer.count({ where }),
  ]);

  return {
    data: rows.map(toPublic),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getPublicOfferBySlug(slug: string): Promise<PublicOffer | null> {
  const row = await db.offer.findFirst({
    where: { slug, status: "PUBLISHED", deletedAt: null },
    select: PUBLIC_SELECT,
  });
  return row ? toPublic(row) : null;
}
