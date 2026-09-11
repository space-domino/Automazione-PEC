import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDb, db } from "@/lib/db";
import { features } from "@/lib/env";
import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { checkRedis } from "@/lib/redis";
import { getSetting } from "@/lib/settings";
import { pecHealth } from "@/services/pec";
import { pingStorefront } from "@/services/spacedomino";

/**
 * Stato di salute del sistema (sezione 30 / M12). Composto: infrastruttura,
 * code, integrazioni esterne, e "check di rischio" sui dati fermi.
 */

export type CheckStatus = "ok" | "warn" | "down";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface SystemHealth {
  status: "ok" | "degraded" | "down";
  checks: HealthCheck[];
  generatedAt: string;
}

const HEARTBEAT_FILE = join(tmpdir(), "worker-alive");

function workerCheck(): HealthCheck {
  try {
    const ageMs = Date.now() - statSync(HEARTBEAT_FILE).mtimeMs;
    if (ageMs < 90_000)
      return { name: "worker", status: "ok", detail: `heartbeat ${Math.round(ageMs / 1000)}s fa` };
    if (ageMs < 300_000)
      return {
        name: "worker",
        status: "warn",
        detail: `heartbeat ${Math.round(ageMs / 1000)}s fa`,
      };
    return { name: "worker", status: "down", detail: `heartbeat ${Math.round(ageMs / 1000)}s fa` };
  } catch {
    return { name: "worker", status: "down", detail: "nessun heartbeat" };
  }
}

async function queuesCheck(): Promise<HealthCheck> {
  try {
    const names = Object.values(QUEUE_NAMES);
    const counts = await Promise.all(
      names.map((n) => getQueue(n).getJobCounts("failed", "waiting")),
    );
    const failed = counts.reduce((s, c) => s + (c.failed ?? 0), 0);
    const waiting = counts.reduce((s, c) => s + (c.waiting ?? 0), 0);
    if (failed > 0)
      return {
        name: "queues",
        status: "warn",
        detail: `${failed} job falliti, ${waiting} in attesa`,
      };
    if (waiting > 500)
      return { name: "queues", status: "warn", detail: `${waiting} job in attesa` };
    return { name: "queues", status: "ok", detail: `${waiting} in attesa` };
  } catch (err) {
    return {
      name: "queues",
      status: "warn",
      detail: err instanceof Error ? err.message : "non raggiungibili",
    };
  }
}

/** Conteggi di rischio sui dati. */
export async function riskChecks(): Promise<HealthCheck[]> {
  const now = Date.now();
  const staleAvail = new Date(now - 3 * 86_400_000);
  const stuckSending = new Date(now - 3_600_000);
  const oldTransfer = new Date(now - 14 * 86_400_000);
  const last24h = new Date(now - 86_400_000);

  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const availStale = await db.domain.count({
    where: {
      deletedAt: null,
      availabilityResult: { in: ["UNKNOWN", "ERROR"] },
      availabilityCheckedAt: { lt: staleAvail },
    },
  });
  const pecStuck = await db.communication.count({
    where: { status: "SENDING", updatedAt: { lt: stuckSending } },
  });
  const transferStuck = await db.order.count({
    where: { domain: { status: "TRANSFER_PENDING" }, transferStartedAt: { lt: oldTransfer } },
  });
  const jobsFailed = await db.jobRecord.count({
    where: { status: "FAILED", finishedAt: { gte: last24h } },
  });
  const aiBudget = await db.aiUsage.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: last24h } },
  });
  const budget = await getSetting("ai.daily_budget_usd");

  const checks: HealthCheck[] = [
    availStale > 0
      ? {
          name: "availability_stale",
          status: "warn",
          detail: `${availStale} domini UNKNOWN/ERROR da >3g`,
        }
      : { name: "availability_stale", status: "ok" },
    pecStuck > 0
      ? { name: "pec_stuck", status: "warn", detail: `${pecStuck} PEC ferme in SENDING da >1h` }
      : { name: "pec_stuck", status: "ok" },
    transferStuck > 0
      ? {
          name: "transfer_stuck",
          status: "warn",
          detail: `${transferStuck} trasferimenti aperti da >14g`,
        }
      : { name: "transfer_stuck", status: "ok" },
    jobsFailed > 0
      ? {
          name: "jobs_failed_24h",
          status: "warn",
          detail: `${jobsFailed} job falliti nelle ultime 24h`,
        }
      : { name: "jobs_failed_24h", status: "ok" },
  ];

  const spent = Number(aiBudget._sum.costUsd ?? 0);
  if (spent > budget) {
    checks.push({
      name: "ai_budget",
      status: "warn",
      detail: `spesa AI 24h $${spent.toFixed(2)} oltre il budget $${budget}`,
    });
  }

  return checks;
}

export async function systemHealth(): Promise<SystemHealth> {
  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché
  // (qui più checkDb/riskChecks condividono la stessa connessione Postgres).
  const dbOk = await checkDb();
  const redisOk = await checkRedis();
  const queues = await queuesCheck();
  const pec = features.pec ? await pecHealth() : null;
  const storefront = features.storefront ? await pingStorefront() : null;
  const risks = await riskChecks();

  const checks: HealthCheck[] = [
    { name: "database", status: dbOk ? "ok" : "down" },
    { name: "redis", status: redisOk ? "ok" : "down" },
    workerCheck(),
    queues,
  ];

  if (pec) {
    const ok = pec.smtp.ok && (pec.imap.configured ? pec.imap.ok : true);
    checks.push({
      name: "pec",
      status: ok ? "ok" : "warn",
      detail: `smtp ${pec.smtp.ok ? "ok" : pec.smtp.error} · imap ${pec.imap.ok ? "ok" : (pec.imap.error ?? "n/d")}`,
    });
  } else {
    checks.push({ name: "pec", status: "ok", detail: "non configurata" });
  }

  if (storefront) {
    checks.push({
      name: "storefront",
      status: storefront.ok ? "ok" : "warn",
      detail: storefront.ok ? `${storefront.products} prodotti` : storefront.error,
    });
  } else {
    checks.push({ name: "storefront", status: "ok", detail: "non collegato" });
  }

  checks.push(...risks);

  const status = checks.some((c) => c.status === "down")
    ? "down"
    : checks.some((c) => c.status === "warn")
      ? "degraded"
      : "ok";

  return { status, checks, generatedAt: new Date().toISOString() };
}
