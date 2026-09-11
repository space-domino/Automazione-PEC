import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface ActivityListParams {
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

export interface ActivityItem {
  id: string;
  kind: "transition" | "audit";
  createdAt: Date;
  entityType: string;
  entityId: string;
  actor: string;
  summary: string;
}

/**
 * Feed unificato di StateTransition + AuditLog (sezione 18).
 * Volumi MVP bassi: si prende un margine e si unisce/ordina/pagina in memoria.
 */
export async function listActivity(p: ActivityListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, p.pageSize ?? 50));

  const stWhere: Prisma.StateTransitionWhereInput = {};
  const alWhere: Prisma.AuditLogWhereInput = {};
  if (p.entityType) {
    stWhere.entityType = p.entityType;
    alWhere.entityType = p.entityType;
  }
  if (p.entityId) {
    stWhere.entityId = p.entityId;
    alWhere.entityId = p.entityId;
  }

  const margin = page * pageSize + pageSize;
  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const transitions = await db.stateTransition.findMany({
    where: stWhere,
    orderBy: { createdAt: "desc" },
    take: margin,
  });
  const audits = await db.auditLog.findMany({
    where: alWhere,
    orderBy: { createdAt: "desc" },
    take: margin,
  });
  const stTotal = await db.stateTransition.count({ where: stWhere });
  const alTotal = await db.auditLog.count({ where: alWhere });

  const merged: ActivityItem[] = [
    ...transitions.map(
      (t): ActivityItem => ({
        id: `t_${t.id}`,
        kind: "transition",
        createdAt: t.createdAt,
        entityType: t.entityType,
        entityId: t.entityId,
        actor: t.actorType,
        summary: `${t.fromStatus ?? "∅"} → ${t.toStatus}${t.reason ? ` · ${t.reason}` : ""}`,
      }),
    ),
    ...audits.map(
      (a): ActivityItem => ({
        id: `a_${a.id}`,
        kind: "audit",
        createdAt: a.createdAt,
        entityType: a.entityType,
        entityId: a.entityId,
        actor: a.actorType,
        summary: a.summary ?? a.action,
      }),
    ),
  ].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());

  const start = (page - 1) * pageSize;
  const total = stTotal + alTotal;
  return {
    data: merged.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
