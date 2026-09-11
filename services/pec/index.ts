import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { pingImap } from "./imap";
import { verifyTransport } from "./transport";

export { composePecDraft, previewPec } from "./compose";
export type { ComposeOptions } from "./compose";
export {
  PecNotConfiguredError,
  PecRecipientMissingError,
  PecSuppressedError,
} from "./errors";
export { polishPec } from "./proposal";
export type { PolishOptions } from "./proposal";
export { classifyReceipt, ingestReceipt, pollReceipts } from "./receipts";
export type { ParsedReceipt, PollResult } from "./receipts";
export { approvePec, cancelPec, queuePecSend, sendApprovedPec } from "./send";
export type { SendResult } from "./send";
export { assertNotSuppressed, findSuppression } from "./suppression";
export { sendPec } from "./transport";
export type { SendPecInput, SendPecResult } from "./transport";

const COMM_INCLUDE = {
  company: { select: { id: true, legalName: true, pec: true } },
  offer: { select: { id: true, slug: true, title: true } },
  receipts: { orderBy: { receivedAt: "asc" } },
} satisfies Prisma.CommunicationInclude;

export interface CommunicationListParams {
  status?: string;
  companyId?: string;
  offerId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function listCommunications(p: CommunicationListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));

  const where: Prisma.CommunicationWhereInput = {};
  if (p.status) where.status = p.status as Prisma.CommunicationWhereInput["status"];
  if (p.companyId) where.companyId = p.companyId;
  if (p.offerId) where.offerId = p.offerId;
  if (p.q) {
    where.OR = [
      { recipient: { contains: p.q, mode: "insensitive" } },
      { subject: { contains: p.q, mode: "insensitive" } },
    ];
  }

  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const data = await db.communication.findMany({
    where,
    include: COMM_INCLUDE,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const total = await db.communication.count({ where });
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getCommunication(id: string) {
  return db.communication.findUnique({ where: { id }, include: COMM_INCLUDE });
}

export interface PecHealth {
  smtp: Awaited<ReturnType<typeof verifyTransport>>;
  imap: Awaited<ReturnType<typeof pingImap>>;
}

export async function pecHealth(): Promise<PecHealth> {
  const [smtp, imap] = await Promise.all([verifyTransport(), pingImap()]);
  return { smtp, imap };
}
