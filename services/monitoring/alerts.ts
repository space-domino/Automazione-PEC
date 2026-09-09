import { db } from "@/lib/db";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { NotificationSeverity, Prisma } from "@prisma/client";
import { riskChecks, systemHealth } from "./health";

/**
 * Notifiche/alert interni (sezione 30 / M12). Ogni alert è una riga `Notification`;
 * se `features.n8n`, viene anche inoltrato al webhook n8n per l'instradamento
 * (email/Telegram/…). Deduplica per `type` + `dedupeKey` entro una finestra.
 */

const log = logger.child({ svc: "alerts" });
const DEDUPE_WINDOW_MS = 6 * 3600_000;

export interface RaiseAlertInput {
  type: string;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  data?: Prisma.InputJsonValue;
  /** se una notifica non letta con stesso type+dedupeKey esiste nella finestra, non ne crea un'altra */
  dedupeKey?: string;
}

async function forwardToN8n(payload: Record<string, unknown>): Promise<void> {
  if (!features.n8n || !env.N8N_WEBHOOK_URL) return;
  try {
    await fetch(env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.N8N_WEBHOOK_TOKEN ? { authorization: `Bearer ${env.N8N_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, "n8n webhook non raggiungibile");
  }
}

export interface RaiseAlertResult {
  created: boolean;
  notificationId?: string;
}

export async function raiseAlert(input: RaiseAlertInput): Promise<RaiseAlertResult> {
  const severity: NotificationSeverity = input.severity ?? "WARN";

  if (input.dedupeKey) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const dup = await db.notification.findFirst({
      where: {
        type: input.type,
        readAt: null,
        createdAt: { gte: since },
        data: { path: ["dedupeKey"], equals: input.dedupeKey },
      },
      select: { id: true },
    });
    if (dup) return { created: false, notificationId: dup.id };
  }

  const data = {
    ...(input.data && typeof input.data === "object"
      ? (input.data as Record<string, unknown>)
      : {}),
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
  };

  const n = await db.notification.create({
    data: {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      severity,
      data: data as Prisma.InputJsonValue,
    },
  });

  await forwardToN8n({
    event: "alert",
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    severity,
    notificationId: n.id,
    at: n.createdAt.toISOString(),
  });

  log.info({ type: input.type, severity, id: n.id }, "alert generato");
  return { created: true, notificationId: n.id };
}

export interface ScanResult {
  checked: number;
  raised: number;
  health: "ok" | "degraded" | "down";
}

/** Esegue i check di rischio + salute e alza un alert per ogni anomalia. */
export async function scanForAlerts(): Promise<ScanResult> {
  const [risks, health] = await Promise.all([riskChecks(), systemHealth()]);
  let raised = 0;

  for (const c of risks) {
    if (c.status === "ok") continue;
    const r = await raiseAlert({
      type: `risk.${c.name}`,
      title: c.detail ?? c.name,
      severity: c.status === "down" ? "ERROR" : "WARN",
      dedupeKey: c.name,
      data: { check: c.name },
    });
    if (r.created) raised++;
  }

  const infra = health.checks.filter(
    (c) => ["database", "redis", "worker", "queues"].includes(c.name) && c.status !== "ok",
  );
  for (const c of infra) {
    const r = await raiseAlert({
      type: `infra.${c.name}`,
      title: `${c.name}: ${c.status}`,
      body: c.detail,
      severity: c.status === "down" ? "ERROR" : "WARN",
      dedupeKey: c.name,
    });
    if (r.created) raised++;
  }

  return { checked: risks.length + infra.length, raised, health: health.status };
}

// ---------------------------------------------------------------------------
//  Lettura / gestione notifiche
// ---------------------------------------------------------------------------

export interface NotificationListParams {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listNotifications(p: NotificationListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));
  const where: Prisma.NotificationWhereInput = p.unreadOnly ? { readAt: null } : {};

  const [data, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { readAt: null } }),
  ]);
  return {
    data,
    total,
    unread,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function markNotificationRead(id: string) {
  return db.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await db.notification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}
