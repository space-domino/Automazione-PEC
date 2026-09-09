import type { ActorType, Prisma } from "@prisma/client";

/** Client compatibile sia con `db` sia con una transaction client. */
type AuditClient = {
  auditLog: {
    create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown>;
  };
};

export interface AuditArgs {
  action: string;
  entityType: string;
  entityId: string;
  actorType?: ActorType;
  actorUserId?: string;
  summary?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  apiCall?: string;
  error?: string;
  requestId?: string;
  ip?: string;
}

/** Scrive una riga AuditLog (sezione 18). Usato dal motore a stati e dalle azioni. */
export async function writeAudit(client: AuditClient, a: AuditArgs): Promise<void> {
  await client.auditLog.create({
    data: {
      actorType: a.actorType ?? "SYSTEM",
      actorUserId: a.actorUserId ?? null,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      summary: a.summary ?? null,
      before: a.before,
      after: a.after,
      apiCall: a.apiCall ?? null,
      error: a.error ?? null,
      requestId: a.requestId ?? null,
      ip: a.ip ?? null,
    },
  });
}
