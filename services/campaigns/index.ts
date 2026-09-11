import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { normalizeCompany } from "@/services/company-registry/normalize";
import { createOffer } from "@/services/offers";
import { composePecDraft } from "@/services/pec/compose";
import { approvePec, queuePecSend } from "@/services/pec/send";
import { markAsPurchased } from "@/services/purchase";
import { domainStateConfig, transition } from "@/services/state-machine";
import type { Prisma } from "@prisma/client";
import { type Confidence, type Match, loadCatalog, matchAll, parseCompaniesText } from "./match";

const log = logger.child({ svc: "campaigns" });

export interface Actor {
  userId?: string;
  requestId?: string;
}

export type RowStatus = "pending" | "conflict" | "sent" | "failed" | "skipped";

export interface CampaignRow {
  row: number;
  legalName: string;
  province: string;
  pec: string;
  domain: string | null; // sld, senza tld
  tld: string | null; // es. ".it"
  listPrice: number | null;
  confidence: Confidence;
  score: number;
  status: RowStatus;
  detail: string | null;
  communicationId: string | null;
}

interface CampaignRowsShape {
  rows: CampaignRow[];
}

function toRow(m: Match, i: number): CampaignRow {
  return {
    row: i + 1,
    legalName: m.company.legalName,
    province: m.company.province,
    pec: m.company.pec,
    domain: m.product?.name ?? null,
    tld: m.product?.tld ?? null,
    listPrice: m.product?.price ?? null,
    confidence: m.conf,
    score: m.score,
    status: m.product ? "pending" : "skipped",
    detail: m.product ? null : "nessun dominio corrispondente a catalogo",
    communicationId: null,
  };
}

function rowsOf(rows: Prisma.JsonValue): CampaignRow[] {
  return (rows as unknown as CampaignRowsShape as unknown as CampaignRow[]) ?? [];
}

export interface CampaignSummary {
  id: string;
  name: string;
  templateName: string;
  promoPrice: number | null;
  status: string;
  total: number;
  counts: Record<RowStatus, number>;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

function summarize(c: {
  id: string;
  name: string;
  templateName: string;
  promoPrice: Prisma.Decimal | null;
  status: string;
  rows: Prisma.JsonValue;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}): CampaignSummary {
  const rows = rowsOf(c.rows);
  const counts: Record<RowStatus, number> = {
    pending: 0,
    conflict: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  for (const r of rows) counts[r.status]++;
  return {
    id: c.id,
    name: c.name,
    templateName: c.templateName,
    promoPrice: c.promoPrice ? Number(c.promoPrice) : null,
    status: c.status,
    total: rows.length,
    counts,
    createdAt: c.createdAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    error: c.error,
  };
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const rows = await db.campaign.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(summarize);
}

export interface CampaignDetail extends CampaignSummary {
  rows: CampaignRow[];
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) return null;
  return { ...summarize(c), rows: rowsOf(c.rows) };
}

export interface CreateCampaignInput {
  name: string;
  companiesText: string;
  templateName: string;
  promoPrice?: number;
}

/** Parsa la lista, abbina al catalogo spacedomino, crea la campagna in stato MATCHED. */
export async function createCampaign(
  input: CreateCampaignInput,
  actor: Actor = {},
): Promise<CampaignDetail> {
  const name = input.name.trim();
  if (!name) throw new ValidationError(undefined, "Nome campagna obbligatorio");

  const { rows: parsed, noPec } = parseCompaniesText(input.companiesText);
  if (parsed.length === 0) {
    throw new ValidationError(
      undefined,
      "Nessuna azienda valida trovata (serve: ragione sociale, provincia, PEC per riga)",
    );
  }

  const tpl = await db.messageTemplate.findFirst({
    where: { type: "PEC_BODY", name: input.templateName },
  });
  if (!tpl) {
    throw new ValidationError(undefined, `Template "${input.templateName}" non trovato`);
  }

  const catalog = await loadCatalog();
  const matches = matchAll(parsed, catalog);
  const rows = matches.map(toRow);

  const created = await db.campaign.create({
    data: {
      name,
      templateName: input.templateName,
      promoPrice: input.promoPrice ?? null,
      status: "MATCHED",
      rows: rows as unknown as Prisma.InputJsonValue,
      catalogSize: catalog.length,
      createdByUserId: actor.userId ?? null,
    },
  });

  log.info(
    { campaignId: created.id, total: rows.length, senzaPec: noPec.length },
    "campagna creata",
  );
  return { ...summarize(created), rows };
}

export interface UpdateRowInput {
  domain?: string | null;
  tld?: string | null;
}

/** Corregge manualmente il dominio abbinato a una riga (solo prima dell'invio). */
export async function updateCampaignRow(
  campaignId: string,
  rowNumber: number,
  input: UpdateRowInput,
): Promise<CampaignDetail> {
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c) throw new NotFoundError("Campagna non trovata");
  if (c.status !== "MATCHED") {
    throw new ConflictError("BAD_STATE", "Modificabile solo prima dell'invio (stato MATCHED)");
  }
  const rows = rowsOf(c.rows);
  const idx = rows.findIndex((r) => r.row === rowNumber);
  if (idx < 0) throw new NotFoundError("Riga non trovata");

  const row = rows[idx];
  if (!row) throw new NotFoundError("Riga non trovata");
  const domain =
    input.domain !== undefined ? (input.domain?.trim().toLowerCase() ?? null) : row.domain;
  const tld = input.tld !== undefined ? (input.tld?.trim().toLowerCase() ?? null) : row.tld;
  rows[idx] = {
    ...row,
    domain,
    tld: tld && !tld.startsWith(".") ? `.${tld}` : tld,
    confidence: "manuale",
    status: domain ? "pending" : "skipped",
    detail: domain ? null : "dominio rimosso manualmente",
  };

  const updated = await db.campaign.update({
    where: { id: campaignId },
    data: { rows: rows as unknown as Prisma.InputJsonValue },
  });
  return { ...summarize(updated), rows };
}

async function saveRow(campaignId: string, rowNumber: number, patch: Partial<CampaignRow>) {
  // read-modify-write: sicuro perché una sola esecuzione del job processa una
  // campagna alla volta, riga per riga in sequenza.
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const rows = rowsOf(c.rows);
  const idx = rows.findIndex((r) => r.row === rowNumber);
  if (idx < 0) return;
  const existing = rows[idx];
  if (!existing) return;
  rows[idx] = { ...existing, ...patch };
  await db.campaign.update({
    where: { id: campaignId },
    data: { rows: rows as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Elabora una riga: crea/riusa azienda+dominio+offerta, compone la PEC col
 * template della campagna e ne accoda l'invio. Se il dominio combacia con un
 * fqdn già presente nel sistema ma di UN'ALTRA azienda, la riga va in
 * "conflict" e NON invia nulla — questo è il bug che ha causato un invio al
 * destinatario sbagliato nella prima campagna manuale: qui non può succedere.
 */
async function processRow(
  campaignId: string,
  row: CampaignRow,
  templateName: string,
  actor: Actor,
) {
  if (!row.domain) {
    await saveRow(campaignId, row.row, { status: "skipped", detail: "nessun dominio abbinato" });
    return;
  }
  const fqdn = `${row.domain}${row.tld ?? ".it"}`.toLowerCase();

  try {
    const norm = normalizeCompany({
      legalName: row.legalName,
      pec: row.pec,
      province: row.province,
    });
    const company = await db.company.upsert({
      where: { dedupeHash: norm.dedupeHash },
      update: { pec: norm.pec },
      create: {
        legalName: norm.legalName,
        normalizedName: norm.normalizedName,
        province: norm.province,
        provinceName: norm.provinceName,
        pec: norm.pec,
        vatNumber: norm.vatNumber,
        website: norm.website,
        sector: norm.sector,
        rawData: { source: `campaign:${campaignId}` },
        dedupeHash: norm.dedupeHash,
      },
    });

    let domain = await db.domain.findUnique({ where: { fqdn } });
    if (domain && domain.companyId !== company.id) {
      await saveRow(campaignId, row.row, {
        status: "conflict",
        detail: `${fqdn} è già nel sistema, assegnato a un'altra azienda: revisiona a mano`,
      });
      return;
    }

    const existingComm = await db.communication.findFirst({
      where: { companyId: company.id, offer: { domainId: domain?.id } },
    });
    if (existingComm) {
      await saveRow(campaignId, row.row, {
        status:
          existingComm.status === "SENT" || existingComm.status === "DELIVERED"
            ? "sent"
            : "pending",
        detail: `PEC già presente (${existingComm.status})`,
        communicationId: existingComm.id,
      });
      return;
    }

    if (!domain) {
      const segs = fqdn.split(".");
      const sld = segs[0] ?? fqdn;
      const extension = segs.slice(1).join(".") || "it";
      domain = await db.domain.create({
        data: {
          companyId: company.id,
          fqdn,
          sld,
          extension,
          status: "AVAILABLE",
          availabilityResult: "AVAILABLE",
          availabilityCheckedAt: new Date(),
          availabilityProvider: "campaign",
          sellingPrice: row.listPrice ?? 499,
        },
      });
    }

    if (["AVAILABLE", "PURCHASE_PENDING"].includes(domain.status)) {
      await markAsPurchased(
        domain.id,
        {
          purchasePrice: 0,
          currency: "EUR",
          registrar: "campaign",
          purchasedAt: new Date(),
          autoPublish: false,
        },
        actor,
      );
      domain = await db.domain.findUniqueOrThrow({ where: { id: domain.id } });
    }

    let offer = await db.offer.findFirst({ where: { domainId: domain.id, deletedAt: null } });
    if (!offer) {
      offer = await createOffer(domain.id, { sellingPrice: row.listPrice ?? 499 }, actor);
    }
    const d = await db.domain.findUniqueOrThrow({ where: { id: domain.id } });
    if (d.status === "OFFER_DRAFT") {
      await transition(domainStateConfig, domain.id, "OFFER_PUBLISHED", {
        actorType: "USER",
        requestId: actor.requestId,
        reason: "campagna: pagina già online sullo storefront",
      });
    }
    if (offer.status === "DRAFT") {
      await db.offer.update({
        where: { id: offer.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
    }

    const comm = await composePecDraft(offer.id, { templateName }, actor);
    await approvePec(comm.id, actor);
    await queuePecSend(comm.id, actor);

    await saveRow(campaignId, row.row, {
      status: "sent",
      detail: "accodata per l'invio",
      communicationId: comm.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await saveRow(campaignId, row.row, { status: "failed", detail: msg.slice(0, 500) });
  }
}

/** Segna la campagna come "in invio" e ne accoda l'elaborazione sul worker. */
export async function startCampaignSend(id: string, actor: Actor = {}): Promise<CampaignDetail> {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Campagna non trovata");
  if (c.status !== "MATCHED") {
    throw new ConflictError("BAD_STATE", `Non inviabile da stato ${c.status}`);
  }
  if (!features.pec) throw new ValidationError(undefined, "SMTP PEC non configurato");

  const { enqueue, QUEUE_NAMES } = await import("@/lib/queue");
  await db.campaign.update({
    where: { id },
    data: { status: "SENDING", startedAt: new Date(), error: null },
  });
  await enqueue(
    QUEUE_NAMES.campaigns,
    "campaign.send",
    { campaignId: id, actorUserId: actor.userId ?? null },
    { dedupeKey: `campaign.send:${id}` },
  );
  const updated = await db.campaign.findUniqueOrThrow({ where: { id } });
  return { ...summarize(updated), rows: rowsOf(updated.rows) };
}

/** Eseguita dal worker: processa tutte le righe "pending" in sequenza. */
export async function runCampaignSend(campaignId: string, actor: Actor): Promise<void> {
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c) return;
  const rows = rowsOf(c.rows);
  const pending = rows.filter((r) => r.status === "pending");
  log.info({ campaignId, pending: pending.length }, "campagna: invio avviato");

  for (const row of pending) {
    await processRow(campaignId, row, c.templateName, actor);
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "DONE", finishedAt: new Date() },
  });
  log.info({ campaignId }, "campagna: invio completato");
}
