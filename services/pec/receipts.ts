import { db } from "@/lib/db";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSetting, setSetting } from "@/lib/settings";
import { communicationStateConfig, transition, writeAudit } from "@/services/state-machine";
import { InvalidTransitionError } from "@/services/state-machine";
import type { CommunicationStatus, ReceiptType } from "@prisma/client";
import { simpleParser } from "mailparser";
import { fetchRaw } from "./imap";

/**
 * Riconoscimento e archiviazione delle ricevute PEC (sezione H.7).
 *
 * Una ricevuta PEC porta l'allegato `daticert.xml`:
 *   <postacert tipo="avvenuta-consegna"> ... <dati><msgid>&lt;original&gt;</msgid> ...
 * In fallback si usano gli header `X-Ricevuta` e `X-Riferimento-Message-ID`.
 */

const log = logger.child({ svc: "pec", part: "receipts" });

const TIPO_TO_TYPE: Record<string, ReceiptType> = {
  accettazione: "ACCEPTANCE",
  "non-accettazione": "NON_ACCEPTANCE",
  "presa-in-carico": "TAKING_CHARGE",
  "avvenuta-consegna": "DELIVERY",
  "mancata-consegna": "NON_DELIVERY",
  "errore-consegna": "NON_DELIVERY",
  "preavviso-errore-consegna": "NON_DELIVERY",
  "rilevazione-virus": "ERROR",
};

/** Nuovo stato Communication indotto da una ricevuta (null = nessun cambio). */
const TYPE_TO_STATUS: Partial<Record<ReceiptType, CommunicationStatus>> = {
  ACCEPTANCE: "ACCEPTED",
  DELIVERY: "DELIVERED",
  NON_DELIVERY: "FAILED",
  NON_ACCEPTANCE: "FAILED",
  ERROR: "FAILED",
};

export interface ParsedReceipt {
  type: ReceiptType | null;
  tipoRaw: string | null;
  /** Message-ID del messaggio ORIGINALE a cui la ricevuta si riferisce */
  originalMessageId: string | null;
  /** Message-ID della ricevuta stessa */
  receiptMessageId: string | null;
  recipient: string | null;
  timestamp: Date | null;
}

/** Normalizza un Message-ID: decodifica entità XML, toglie i `<>`, trim. */
function stripAngle(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s
    .trim()
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/^<|>$/g, "")
    .trim();
  return d || null;
}

/** Estrae tipo + riferimenti da una mail grezza. Non tocca il DB. */
export async function classifyReceipt(rawSource: Buffer): Promise<ParsedReceipt> {
  const mail = await simpleParser(rawSource);

  const headers = mail.headers;
  const hdr = (k: string): string | null => {
    const v = headers.get(k);
    return typeof v === "string" ? v : null;
  };

  let tipoRaw: string | null = (hdr("x-ricevuta") ?? "").toLowerCase().trim() || null;
  let originalMessageId = stripAngle(hdr("x-riferimento-message-id"));
  let recipient: string | null = null;

  const attachments = mail.attachments ?? [];
  const daticert = attachments.find((a) => (a.filename ?? "").toLowerCase() === "daticert.xml");
  if (daticert?.content) {
    const xml = daticert.content.toString("utf8");
    const tipoM = xml.match(/<postacert[^>]*\btipo="([^"]+)"/i);
    if (tipoM?.[1]) tipoRaw = tipoM[1].toLowerCase().trim();
    const msgIdM = xml.match(/<msgid>\s*([^<]+?)\s*<\/msgid>/i);
    if (msgIdM?.[1]) originalMessageId = stripAngle(msgIdM[1]);
    const recM = xml.match(/<consegna>\s*([^<]+?)\s*<\/consegna>/i);
    if (recM?.[1]) recipient = recM[1].trim();
  }

  const type = tipoRaw ? (TIPO_TO_TYPE[tipoRaw] ?? null) : null;
  return {
    type,
    tipoRaw,
    originalMessageId,
    receiptMessageId: stripAngle(mail.messageId),
    recipient,
    timestamp: mail.date ?? null,
  };
}

export type IngestOutcome = "recorded" | "duplicate" | "unmatched" | "ignored";

export interface IngestResult {
  status: IngestOutcome;
  communicationId?: string;
  type?: ReceiptType;
}

interface Actor {
  userId?: string;
  requestId?: string;
}

/** Archivia una ricevuta e fa avanzare la Communication collegata. Idempotente. */
export async function ingestReceipt(
  parsed: ParsedReceipt,
  rawSource: Buffer,
  actor: Actor = {},
): Promise<IngestResult> {
  if (!parsed.type || !parsed.originalMessageId) return { status: "ignored" };

  const comm = await db.communication.findUnique({
    where: { providerMessageId: parsed.originalMessageId },
    select: { id: true, status: true },
  });
  if (!comm) return { status: "unmatched" };

  const receiptKey = parsed.receiptMessageId ?? `${parsed.type}:${parsed.originalMessageId}`;
  const existing = await db.pecReceipt.findUnique({
    where: {
      communicationId_type_providerMessageId: {
        communicationId: comm.id,
        type: parsed.type,
        providerMessageId: receiptKey,
      },
    },
    select: { id: true },
  });
  if (existing) return { status: "duplicate", communicationId: comm.id, type: parsed.type };

  await db.pecReceipt.create({
    data: {
      communicationId: comm.id,
      type: parsed.type,
      providerMessageId: receiptKey,
      receivedAt: parsed.timestamp ?? new Date(),
      parsedData: {
        tipoRaw: parsed.tipoRaw,
        recipient: parsed.recipient,
        originalMessageId: parsed.originalMessageId,
      },
      rawSource: rawSource.toString("utf8").slice(0, 100_000),
    },
  });

  const nextStatus = TYPE_TO_STATUS[parsed.type];
  if (nextStatus && nextStatus !== comm.status) {
    try {
      await transition(communicationStateConfig, comm.id, nextStatus, {
        actorType: "WEBHOOK",
        actorUserId: actor.userId,
        requestId: actor.requestId,
        reason: `ricevuta PEC ${parsed.tipoRaw}`,
        metadata: { receiptType: parsed.type },
      });
    } catch (err) {
      if (!(err instanceof InvalidTransitionError)) throw err;
      log.warn(
        { communicationId: comm.id, from: comm.status, to: nextStatus },
        "ricevuta: transizione non ammessa, registro solo la ricevuta",
      );
    }
  }

  await writeAudit(db, {
    action: `pec.receipt.${parsed.type.toLowerCase()}`,
    entityType: "Communication",
    entityId: comm.id,
    actorType: "WEBHOOK",
    summary: `Ricevuta PEC: ${parsed.tipoRaw}`,
    after: { type: parsed.type, recipient: parsed.recipient },
    requestId: actor.requestId,
  });

  return { status: "recorded", communicationId: comm.id, type: parsed.type };
}

export interface PollResult {
  skipped?: "pec-disabled";
  scanned: number;
  recorded: number;
  duplicate: number;
  unmatched: number;
  ignored: number;
  failed: number;
  highestUid: number;
}

/** Poll IMAP -> classifica -> archivia. Aggiorna il cursore UID. */
export async function pollReceipts(actor: Actor = {}): Promise<PollResult> {
  const base: PollResult = {
    scanned: 0,
    recorded: 0,
    duplicate: 0,
    unmatched: 0,
    ignored: 0,
    failed: 0,
    highestUid: 0,
  };
  if (!features.pec || !env.PEC_IMAP_HOST) return { ...base, skipped: "pec-disabled" };

  const afterUid = await getSetting("pec.imap.last_uid");
  const sinceDays = await getSetting("pec.receipts.lookback_days");
  base.highestUid = afterUid;

  const { messages, highestUid } = await fetchRaw({ afterUid, sinceDays });
  base.scanned = messages.length;

  for (const m of messages) {
    try {
      const parsed = await classifyReceipt(m.source);
      const r = await ingestReceipt(parsed, m.source, actor);
      base[r.status]++;
    } catch (err) {
      base.failed++;
      log.warn({ err, uid: m.uid, subject: m.subject }, "ingest ricevuta fallito");
    }
  }

  if (highestUid > afterUid) {
    await setSetting("pec.imap.last_uid", highestUid);
    base.highestUid = highestUid;
  }
  log.info(base, "poll ricevute PEC completato");
  return base;
}
