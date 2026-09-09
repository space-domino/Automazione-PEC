import { ConflictError, NotFoundError, RateLimitError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { QUEUE_NAMES, enqueue } from "@/lib/queue";
import { getSetting } from "@/lib/settings";
import {
  communicationStateConfig,
  domainStateConfig,
  forceTransition,
  transition,
  writeAudit,
} from "@/services/state-machine";
import type { CommunicationStatus, Prisma } from "@prisma/client";
import { PecNotConfiguredError } from "./errors";
import { htmlToText } from "./render";
import { findSuppression } from "./suppression";
import { sendPec } from "./transport";

/**
 * Approvazione e invio della PEC (sezione H.7 / M10).
 * L'invio non parte mai in automatico: prima `approvePec`, poi `sendApprovedPec`
 * (diretto o via job `pec.send`).
 */

const log = logger.child({ svc: "pec", part: "send" });

export interface Actor {
  userId?: string;
  requestId?: string;
}

const COMM_INCLUDE = {
  company: { select: { id: true, pec: true, vatNumber: true, legalName: true } },
  offer: { select: { domainId: true, domain: { select: { id: true, fqdn: true, status: true } } } },
} satisfies Prisma.CommunicationInclude;

type CommBundle = Prisma.CommunicationGetPayload<{ include: typeof COMM_INCLUDE }>;

async function loadBundle(id: string): Promise<CommBundle> {
  const comm = await db.communication.findUnique({ where: { id }, include: COMM_INCLUDE });
  if (!comm) throw new NotFoundError("Comunicazione inesistente");
  return comm;
}

const DONE: readonly CommunicationStatus[] = ["SENT", "ACCEPTED", "DELIVERED"];

function ctxOf(actor: Actor, reason: string) {
  return {
    actorType: "USER" as const,
    actorUserId: actor.userId,
    requestId: actor.requestId,
    reason,
  };
}

/** DRAFT -> APPROVED. Ricontrolla la soppressione. Porta il Domain a PEC_APPROVED. */
export async function approvePec(id: string, actor: Actor) {
  const comm = await loadBundle(id);
  if (comm.status !== "DRAFT") {
    throw new ConflictError("BAD_STATE", `Approvabile solo da DRAFT (ora ${comm.status})`);
  }
  const dom = comm.offer?.domain;
  if (dom) {
    const sup = await findSuppression(comm.company, dom.fqdn);
    if (sup) {
      throw new ConflictError(
        "PEC_SUPPRESSED",
        `Destinatario soppresso: ${sup.type} (${sup.reason})`,
      );
    }
  }

  await transition(communicationStateConfig, id, "APPROVED", ctxOf(actor, "approvazione PEC"), {
    approvedByUserId: actor.userId ?? null,
    approvedAt: new Date(),
  });
  if (dom && dom.status === "PEC_DRAFT") {
    await transition(domainStateConfig, dom.id, "PEC_APPROVED", ctxOf(actor, "PEC approvata"));
  }

  await writeAudit(db, {
    action: "pec.approve",
    entityType: "Communication",
    entityId: id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `PEC approvata per ${comm.recipient}`,
  });
  return getStatus(id);
}

/** Qualsiasi stato non inviato -> CANCELLED. Riporta il Domain a OFFER_PUBLISHED. */
export async function cancelPec(id: string, reason: string, actor: Actor) {
  const comm = await loadBundle(id);
  if (DONE.includes(comm.status)) {
    throw new ConflictError("BAD_STATE", "PEC già inviata: non annullabile");
  }
  await forceTransition(communicationStateConfig, id, "CANCELLED", {
    ...ctxOf(actor, reason?.trim() || "PEC annullata"),
    reason: reason?.trim() || "PEC annullata",
  });
  const dom = comm.offer?.domain;
  if (dom && (dom.status === "PEC_DRAFT" || dom.status === "PEC_APPROVED")) {
    await transition(domainStateConfig, dom.id, "OFFER_PUBLISHED", ctxOf(actor, "PEC annullata"));
  }
  await writeAudit(db, {
    action: "pec.cancel",
    entityType: "Communication",
    entityId: id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `PEC annullata: ${reason?.trim() || "—"}`,
  });
  return getStatus(id);
}

export interface SendResult {
  status: "sent" | "already" | "suppressed";
  communicationId: string;
  providerMessageId?: string | null;
}

/** APPROVED|QUEUED|FAILED -> SENT. Invia davvero via SMTP. Idempotente sugli stati finali. */
export async function sendApprovedPec(id: string, actor: Actor): Promise<SendResult> {
  const comm = await loadBundle(id);
  if (DONE.includes(comm.status)) {
    return { status: "already", communicationId: id, providerMessageId: comm.providerMessageId };
  }
  if (!["APPROVED", "QUEUED", "FAILED"].includes(comm.status)) {
    throw new ConflictError("BAD_STATE", `Non inviabile da stato ${comm.status}`);
  }
  if (!features.pec) throw new PecNotConfiguredError("SMTP PEC");

  const dom = comm.offer?.domain ?? null;

  // soppressione sopravvenuta -> annulla invece di inviare
  const sup = dom ? await findSuppression(comm.company, dom.fqdn) : null;
  if (sup) {
    await forceTransition(communicationStateConfig, id, "CANCELLED", {
      ...ctxOf(actor, "soppressione sopravvenuta"),
      reason: "soppressione sopravvenuta",
    });
    if (dom && (dom.status === "PEC_DRAFT" || dom.status === "PEC_APPROVED")) {
      await transition(domainStateConfig, dom.id, "OFFER_PUBLISHED", ctxOf(actor, "PEC soppressa"));
    }
    log.warn({ id, suppression: sup.type }, "invio PEC annullato: destinatario soppresso");
    return { status: "suppressed", communicationId: id };
  }

  // rate-limit orario (fail-open se Redis è giù)
  const max = await getSetting("pec.max_per_hour");
  const rl = await rateLimit("pec:send", max, 3600);
  if (!rl.ok) throw new RateLimitError(rl.retryAfter);

  // normalizza -> SENDING
  if (comm.status === "APPROVED") {
    await transition(communicationStateConfig, id, "QUEUED", ctxOf(actor, "in coda invio"), {
      queuedAt: new Date(),
    });
  } else if (comm.status === "FAILED") {
    await transition(communicationStateConfig, id, "QUEUED", ctxOf(actor, "reinvio dopo errore"));
  }
  await transition(communicationStateConfig, id, "SENDING", ctxOf(actor, "invio in corso"));

  try {
    const res = await sendPec({
      to: comm.recipient,
      subject: comm.subject,
      html: comm.bodyHtml,
      text: comm.bodyText ?? htmlToText(comm.bodyHtml),
      headers: { "X-DRP-Communication": comm.id },
    });

    await transition(communicationStateConfig, id, "SENT", ctxOf(actor, "PEC inviata"), {
      sentAt: new Date(),
      providerMessageId: res.messageId || null,
    });
    if (dom && dom.status === "PEC_APPROVED") {
      await transition(domainStateConfig, dom.id, "PEC_SENT", ctxOf(actor, "PEC inviata"));
    }

    await writeAudit(db, {
      action: "pec.send",
      entityType: "Communication",
      entityId: id,
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      after: { providerMessageId: res.messageId, to: comm.recipient },
      summary: `PEC inviata a ${comm.recipient}`,
    });
    log.info({ id, messageId: res.messageId }, "PEC inviata");
    return { status: "sent", communicationId: id, providerMessageId: res.messageId || null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await transition(communicationStateConfig, id, "FAILED", ctxOf(actor, "invio fallito"), {
      lastError: msg.slice(0, 2000),
      retryCount: { increment: 1 },
    }).catch(() => {});
    log.error({ id, err: msg }, "invio PEC fallito");
    throw err;
  }
}

async function getStatus(id: string) {
  return db.communication.findUnique({ where: { id }, include: COMM_INCLUDE });
}

/** Accoda l'invio asincrono di una PEC (deve essere APPROVED). Il worker esegue `pec.send`. */
export async function queuePecSend(id: string, actor: Actor) {
  const comm = await loadBundle(id);
  if (!["APPROVED", "QUEUED", "FAILED"].includes(comm.status)) {
    throw new ConflictError("BAD_STATE", `Non accodabile da stato ${comm.status}`);
  }
  const { jobId } = await enqueue(
    QUEUE_NAMES.pec,
    "pec.send",
    { communicationId: id },
    { dedupeKey: `pec.send:${id}` },
  );
  await writeAudit(db, {
    action: "pec.send.queued",
    entityType: "Communication",
    entityId: id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: "Invio PEC accodato",
  });
  return { queued: true, jobId, communicationId: id };
}
