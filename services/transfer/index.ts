import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { decryptString, encryptString } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { signToken, verifyToken } from "@/lib/tokens";
import {
  type TransitionCtx,
  domainStateConfig,
  orderStateConfig,
  transition,
  writeAudit,
} from "@/services/state-machine";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Workflow di trasferimento / consegna del dominio venduto (sezione K / M11).
 *
 * A valle della vendita (M8) il Domain è in `SOLD` e l'Order in `PAID`.
 * Qui: SOLD → TRANSFER_PENDING → TRANSFERRED  (Order: PAID → FULFILLMENT_PENDING → TRANSFERRED → COMPLETED).
 * Il codice di autorizzazione (EPP authcode) è cifrato a riposo (`lib/crypto`)
 * e mostrato in chiaro solo tramite `revealAuthCode` (loggato) o la pagina di consegna firmata.
 */

const log = logger.child({ svc: "transfer" });

export interface Actor {
  userId?: string;
  requestId?: string;
}

export const TRANSFER_METHODS = ["EPP_TRANSFER", "REGISTRAR_PUSH", "MANUAL"] as const;
export type TransferMethod = (typeof TRANSFER_METHODS)[number];

export const startTransferSchema = z.object({
  method: z.enum(TRANSFER_METHODS),
  notes: z.string().trim().max(2000).optional(),
  authCode: z.string().trim().min(1).max(200).optional(),
});
export type StartTransferInput = z.infer<typeof startTransferSchema>;

const ORDER_INCLUDE = {
  domain: { select: { id: true, fqdn: true, status: true, registrar: true } },
  company: { select: { id: true, legalName: true } },
} satisfies Prisma.OrderInclude;

function ctxOf(actor: Actor, reason: string): TransitionCtx & { reason: string } {
  return {
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason,
  };
}

async function loadOrder(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  if (!order) throw new NotFoundError("Ordine inesistente");
  return order;
}

// ---------------------------------------------------------------------------
//  Azioni
// ---------------------------------------------------------------------------

/** PAID → FULFILLMENT_PENDING · Domain SOLD → TRANSFER_PENDING. */
export async function startTransfer(orderId: string, input: StartTransferInput, actor: Actor) {
  const order = await loadOrder(orderId);
  if (order.orderStatus !== "PAID") {
    throw new ConflictError(
      "BAD_STATE",
      `Trasferimento avviabile da PAID (ora ${order.orderStatus})`,
    );
  }
  if (order.domain.status !== "SOLD") {
    throw new ConflictError("BAD_STATE", `Il dominio non è in SOLD (${order.domain.status})`);
  }

  await transition(
    domainStateConfig,
    order.domainId,
    "TRANSFER_PENDING",
    ctxOf(actor, "avvio trasferimento"),
  );

  const extra: Prisma.OrderUpdateInput = {
    transferStartedAt: new Date(),
    transferMethod: input.method,
  };
  if (input.notes) extra.transferNotes = input.notes;
  if (input.authCode) extra.transferAuthCodeEnc = encryptString(input.authCode);

  await transition(
    orderStateConfig,
    orderId,
    "FULFILLMENT_PENDING",
    ctxOf(actor, `metodo ${input.method}`),
    extra as Record<string, unknown>,
  );

  await writeAudit(db, {
    action: "transfer.start",
    entityType: "Order",
    entityId: orderId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    after: { method: input.method, hasAuthCode: Boolean(input.authCode) },
    summary: `Trasferimento avviato per ${order.domain.fqdn} (${input.method})`,
  });
  return getTransfer(orderId);
}

/** Imposta/sostituisce il codice di autorizzazione cifrato. Nessun cambio di stato. */
export async function setTransferAuthCode(orderId: string, authCode: string, actor: Actor) {
  const order = await loadOrder(orderId);
  if (!["FULFILLMENT_PENDING", "TRANSFERRED"].includes(order.orderStatus)) {
    throw new ConflictError("BAD_STATE", "Authcode impostabile solo durante il trasferimento");
  }
  await db.order.update({
    where: { id: orderId },
    data: { transferAuthCodeEnc: encryptString(authCode.trim()) },
  });
  await writeAudit(db, {
    action: "transfer.authcode.set",
    entityType: "Order",
    entityId: orderId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `Authcode aggiornato per ${order.domain.fqdn}`,
  });
  return getTransfer(orderId);
}

/** FULFILLMENT_PENDING → TRANSFERRED → COMPLETED · Domain TRANSFER_PENDING → TRANSFERRED. */
export async function completeTransfer(orderId: string, opts: { notes?: string }, actor: Actor) {
  const order = await loadOrder(orderId);
  if (order.orderStatus !== "FULFILLMENT_PENDING") {
    throw new ConflictError(
      "BAD_STATE",
      `Completabile da FULFILLMENT_PENDING (ora ${order.orderStatus})`,
    );
  }
  if (order.domain.status !== "TRANSFER_PENDING") {
    throw new ConflictError(
      "BAD_STATE",
      `Dominio non in TRANSFER_PENDING (${order.domain.status})`,
    );
  }

  await transition(
    domainStateConfig,
    order.domainId,
    "TRANSFERRED",
    ctxOf(actor, "trasferimento completato"),
  );

  const extra: Prisma.OrderUpdateInput = { transferCompletedAt: new Date() };
  if (opts.notes) extra.transferNotes = opts.notes;
  await transition(
    orderStateConfig,
    orderId,
    "TRANSFERRED",
    ctxOf(actor, "dominio consegnato"),
    extra as Record<string, unknown>,
  );
  await transition(orderStateConfig, orderId, "COMPLETED", ctxOf(actor, "ordine evaso"));

  await writeAudit(db, {
    action: "transfer.complete",
    entityType: "Order",
    entityId: orderId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `Trasferimento completato: ${order.domain.fqdn}`,
  });
  return getTransfer(orderId);
}

/** Domain TRANSFER_PENDING → TRANSFER_FAILED. L'Order resta FULFILLMENT_PENDING. */
export async function failTransfer(orderId: string, reason: string, actor: Actor) {
  const order = await loadOrder(orderId);
  if (order.domain.status !== "TRANSFER_PENDING") {
    throw new ConflictError(
      "BAD_STATE",
      `Dominio non in TRANSFER_PENDING (${order.domain.status})`,
    );
  }
  const msg = reason?.trim() || "trasferimento fallito";
  await transition(domainStateConfig, order.domainId, "TRANSFER_FAILED", ctxOf(actor, msg));

  const prev = order.transferNotes ? `${order.transferNotes}\n` : "";
  await db.order.update({
    where: { id: orderId },
    data: { transferNotes: `${prev}[${new Date().toISOString()}] FALLITO: ${msg}`.slice(0, 4000) },
  });
  await writeAudit(db, {
    action: "transfer.fail",
    entityType: "Order",
    entityId: orderId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `Trasferimento fallito (${order.domain.fqdn}): ${msg}`,
  });
  return getTransfer(orderId);
}

/** Domain TRANSFER_FAILED → TRANSFER_PENDING (nuovo tentativo). */
export async function retryTransfer(orderId: string, actor: Actor) {
  const order = await loadOrder(orderId);
  if (order.domain.status !== "TRANSFER_FAILED") {
    throw new ConflictError("BAD_STATE", `Dominio non in TRANSFER_FAILED (${order.domain.status})`);
  }
  await transition(
    domainStateConfig,
    order.domainId,
    "TRANSFER_PENDING",
    ctxOf(actor, "nuovo tentativo"),
  );
  await writeAudit(db, {
    action: "transfer.retry",
    entityType: "Order",
    entityId: orderId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `Nuovo tentativo di trasferimento: ${order.domain.fqdn}`,
  });
  return getTransfer(orderId);
}

/** Decifra e restituisce l'authcode in chiaro UNA volta. Accesso sensibile: loggato. */
export async function revealAuthCode(orderId: string, actor: Actor): Promise<{ authCode: string }> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { transferAuthCodeEnc: true, domain: { select: { fqdn: true } } },
  });
  if (!order) throw new NotFoundError("Ordine inesistente");
  if (!order.transferAuthCodeEnc) {
    throw new ConflictError("NO_AUTHCODE", "Nessun codice di autorizzazione salvato");
  }
  const authCode = decryptString(order.transferAuthCodeEnc);
  await writeAudit(db, {
    action: "transfer.authcode.reveal",
    entityType: "Order",
    entityId: orderId,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `Authcode visualizzato in chiaro (${order.domain.fqdn})`,
  });
  log.warn({ orderId, userId: actor.userId }, "authcode rivelato in chiaro");
  return { authCode };
}

// ---------------------------------------------------------------------------
//  Lettura
// ---------------------------------------------------------------------------

export interface TransferListParams {
  stage?: "to_start" | "in_progress" | "failed" | "done";
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listTransfers(p: TransferListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));

  const where: Prisma.OrderWhereInput = {};
  switch (p.stage) {
    case "to_start":
      where.orderStatus = "PAID";
      where.domain = { status: "SOLD" };
      break;
    case "in_progress":
      where.orderStatus = "FULFILLMENT_PENDING";
      where.domain = { status: "TRANSFER_PENDING" };
      break;
    case "failed":
      where.domain = { status: "TRANSFER_FAILED" };
      break;
    case "done":
      where.orderStatus = { in: ["TRANSFERRED", "COMPLETED"] };
      break;
    default:
      where.orderStatus = { in: ["PAID", "FULFILLMENT_PENDING", "TRANSFERRED"] };
  }
  if (p.q) {
    where.OR = [
      { customerEmail: { contains: p.q, mode: "insensitive" } },
      { domain: { fqdn: { contains: p.q.toLowerCase() } } },
    ];
  }

  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const rows = await db.order.findMany({
    where,
    include: ORDER_INCLUDE,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const total = await db.order.count({ where });
  return {
    data: rows.map(sanitize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

type OrderWithRels = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/** Rimuove il campo cifrato, espone solo `hasAuthCode`. */
function sanitize(o: OrderWithRels) {
  const { transferAuthCodeEnc, ...rest } = o;
  return { ...rest, hasAuthCode: Boolean(transferAuthCodeEnc) };
}

export async function getTransfer(orderId: string) {
  const order = await loadOrder(orderId);
  return { ...sanitize(order), deliveryUrl: buildDeliveryUrl(orderId) };
}

// ---------------------------------------------------------------------------
//  Consegna al cliente (link firmato)
// ---------------------------------------------------------------------------

export function buildDeliveryUrl(orderId: string): string {
  const token = signToken("delivery", { o: orderId }, { ttlSec: 60 * 86_400 });
  return `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/delivery/${token}`;
}

function instructionsFor(method: string | null, domain: string, registrar: string | null): string {
  switch (method) {
    case "EPP_TRANSFER":
      return `Inserisci il codice di autorizzazione (authcode / EPP) presso il tuo registrar per avviare il trasferimento di ${domain}. Il dominio è sbloccato e pronto.`;
    case "REGISTRAR_PUSH":
      return `Il dominio ${domain} verrà spostato sul tuo account${registrar ? ` presso ${registrar}` : ""}. Rispondi a questa comunicazione con lo username / ID del tuo account.`;
    case "MANUAL":
      return `Ti contatteremo per concordare i dettagli del trasferimento di ${domain}.`;
    default:
      return `Il trasferimento di ${domain} è in preparazione. Riceverai a breve le istruzioni.`;
  }
}

export interface DeliveryView {
  domain: string;
  domainStatus: string;
  method: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  instructions: string;
  /** presente solo quando il trasferimento è in corso/concluso e l'authcode è disponibile */
  authCode?: string;
}

/** Risolve un token di consegna → dati per la pagina cliente. `null` se il token non è valido. */
export async function resolveDelivery(token: string): Promise<DeliveryView | null> {
  const res = verifyToken<{ o: string }>(token, "delivery");
  if (!res.ok || !res.payload?.o) return null;

  const order = await db.order.findUnique({
    where: { id: res.payload.o },
    select: {
      transferMethod: true,
      transferAuthCodeEnc: true,
      transferStartedAt: true,
      transferCompletedAt: true,
      domain: { select: { fqdn: true, status: true, registrar: true } },
    },
  });
  if (!order) return null;

  const inProgress = ["TRANSFER_PENDING", "TRANSFERRED"].includes(order.domain.status);
  const view: DeliveryView = {
    domain: order.domain.fqdn,
    domainStatus: order.domain.status,
    method: order.transferMethod,
    startedAt: order.transferStartedAt,
    completedAt: order.transferCompletedAt,
    instructions: instructionsFor(order.transferMethod, order.domain.fqdn, order.domain.registrar),
  };
  if (inProgress && order.transferAuthCodeEnc) {
    view.authCode = decryptString(order.transferAuthCodeEnc);
  }
  return view;
}
