import type { Communication, CommunicationStatus, Prisma } from "@prisma/client";
import type { EntityStateConfig } from "./engine";

/** Macchina a stati della Communication PEC (sezione E.4). */
export const COMMUNICATION_TRANSITIONS: Readonly<
  Record<CommunicationStatus, readonly CommunicationStatus[]>
> = {
  DRAFT: ["APPROVED", "CANCELLED"],
  APPROVED: ["QUEUED", "DRAFT", "CANCELLED"],
  QUEUED: ["SENDING", "FAILED", "CANCELLED"],
  SENDING: ["SENT", "FAILED"],
  SENT: ["ACCEPTED", "DELIVERED", "FAILED", "BOUNCED"],
  ACCEPTED: ["DELIVERED", "FAILED", "BOUNCED"],
  DELIVERED: [],
  FAILED: ["QUEUED", "DRAFT"],
  BOUNCED: ["DRAFT"],
  CANCELLED: ["DRAFT"],
};

export const communicationStateConfig: EntityStateConfig<Communication, CommunicationStatus> = {
  entityType: "Communication",
  transitions: COMMUNICATION_TRANSITIONS,
  load: (tx, id) => tx.communication.findUnique({ where: { id } }),
  apply: async (tx, id, to, extra) => {
    await tx.communication.update({
      where: { id },
      data: { status: to, ...((extra ?? {}) as Prisma.CommunicationUpdateInput) },
    });
  },
};
