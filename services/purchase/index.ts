import { ConflictError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { domainStateConfig, transition, writeAudit } from "@/services/state-machine";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export interface Actor {
  userId?: string;
  requestId?: string;
}

export const markPurchasedSchema = z.object({
  purchasePrice: z.coerce.number().nonnegative().max(1_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
  registrar: z.string().trim().min(1).max(100),
  purchasedAt: z.coerce.date().default(() => new Date()),
  purchaseNotes: z.string().trim().max(2000).optional(),
  override: z.boolean().optional(),
});
export type MarkPurchasedInput = z.infer<typeof markPurchasedSchema>;

/** 🚦G2 — l'acquisto è avvenuto FUORI dalla piattaforma; qui se ne registra il fatto. */
export function markAsPurchased(domainId: string, input: MarkPurchasedInput, actor: Actor) {
  return transition(
    domainStateConfig,
    domainId,
    "PURCHASED",
    {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: `acquisto manuale via ${input.registrar}`,
      metadata: input.override ? { override: true } : undefined,
    },
    {
      purchasedAt: input.purchasedAt,
      purchasePrice: input.purchasePrice,
      purchaseCurrency: input.currency,
      registrar: input.registrar,
      purchaseNotes: input.purchaseNotes ?? null,
      purchasedByUserId: actor.userId ?? null,
    },
  );
}

export function discardDomain(domainId: string, reason: string, actor: Actor) {
  return transition(domainStateConfig, domainId, "DISCARDED", {
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason: reason?.trim() || "scartato manualmente",
  });
}

export function reopenDomain(domainId: string, actor: Actor) {
  return transition(domainStateConfig, domainId, "DISCOVERED", {
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason: "riaperto manualmente",
  });
}

export function blockDomain(domainId: string, reason: string, actor: Actor) {
  if (!reason?.trim()) throw new ValidationError(undefined, "Motivo obbligatorio per il blocco");
  return transition(
    domainStateConfig,
    domainId,
    "BLOCKED",
    { actorType: "USER", actorUserId: actor.userId, requestId: actor.requestId, reason },
    { isBlocked: true, blockedReason: reason },
  );
}

export const UNBLOCK_TARGETS = ["AVAILABLE", "DISCOVERED", "DISCARDED"] as const;
export type UnblockTarget = (typeof UNBLOCK_TARGETS)[number];

export function unblockDomain(domainId: string, to: UnblockTarget, reason: string, actor: Actor) {
  return transition(
    domainStateConfig,
    domainId,
    to,
    {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: reason?.trim() || "sblocco manuale",
    },
    { isBlocked: false, blockedReason: null },
  );
}

const PRICING_STATES = new Set(["AVAILABLE", "PURCHASE_PENDING", "PURCHASED", "OFFER_DRAFT"]);

/** PATCH prezzo di vendita / note d'acquisto (consentito solo negli stati pre-offerta). */
export async function updateDomainPricing(
  domainId: string,
  patch: { sellingPrice?: number; purchaseNotes?: string },
  actor: Actor,
) {
  const d = await db.domain.findUnique({
    where: { id: domainId },
    select: { status: true, sellingPrice: true, deletedAt: true },
  });
  if (!d || d.deletedAt) throw new ConflictError("NOT_FOUND", "Dominio inesistente");
  if (!PRICING_STATES.has(d.status)) {
    throw new ConflictError("BAD_STATE", `Prezzo non modificabile in stato ${d.status}`);
  }

  const data: Prisma.DomainUpdateInput = {};
  if (patch.sellingPrice != null) data.sellingPrice = patch.sellingPrice;
  if (patch.purchaseNotes != null) data.purchaseNotes = patch.purchaseNotes;

  const updated = await db.domain.update({ where: { id: domainId }, data });
  await writeAudit(db, {
    action: "domain.pricing.update",
    entityType: "Domain",
    entityId: domainId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    before: { sellingPrice: d.sellingPrice ? Number(d.sellingPrice) : null },
    after: { sellingPrice: updated.sellingPrice ? Number(updated.sellingPrice) : null },
  });
  return updated;
}
