import "dotenv/config";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDb } from "@/lib/db";
import { features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { checkRedis } from "@/lib/redis";
import type { Worker } from "bullmq";
import { scheduleAvailabilityRecheck, startAvailabilityWorker } from "./queues/availability";
import { startCampaignsWorker } from "./queues/campaigns";
import { startDiscoveryWorker } from "./queues/discovery";
import { startImportWorker } from "./queues/import";
import { scheduleMonitoringScan, startMonitoringWorker } from "./queues/monitoring";
import { scheduleReceiptsPoll, startPecWorker } from "./queues/pec";
import { scheduleStorefrontSync, startStorefrontWorker } from "./queues/storefront";

const log = logger.child({ proc: "worker" });
const HEARTBEAT_FILE = join(tmpdir(), "worker-alive");

function heartbeat() {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch {
    // in dev su Windows può fallire: irrilevante (l'healthcheck gira solo nel container)
  }
}

async function main() {
  log.info("worker: avvio");

  const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()]);
  log.info({ dbOk, redisOk }, "worker: connettività");
  if (!dbOk) log.error("worker: PostgreSQL non raggiungibile");
  if (!redisOk) log.error("worker: Redis non raggiungibile");

  heartbeat();
  const timer = setInterval(heartbeat, 15_000);

  // Code registrate. Le prossime milestone aggiungeranno:
  //   ranking · pec · pec-receipts · stripe · notify
  const workers: Worker[] = [
    startImportWorker() as unknown as Worker,
    startDiscoveryWorker() as unknown as Worker,
    startAvailabilityWorker() as unknown as Worker,
    startStorefrontWorker() as unknown as Worker,
    startPecWorker() as unknown as Worker,
    startMonitoringWorker() as unknown as Worker,
    startCampaignsWorker() as unknown as Worker,
  ];
  log.info({ queues: workers.map((w) => w.name) }, "worker: code registrate");

  await scheduleAvailabilityRecheck().catch((err) =>
    log.warn({ err }, "worker: recheck availability non pianificato"),
  );

  if (features.storefront) {
    await scheduleStorefrontSync().catch((err) =>
      log.warn({ err }, "worker: sync vendite storefront non pianificato"),
    );
  }

  if (features.pec) {
    await scheduleReceiptsPoll().catch((err) =>
      log.warn({ err }, "worker: poll ricevute PEC non pianificato"),
    );
  }

  await scheduleMonitoringScan().catch((err) =>
    log.warn({ err }, "worker: scan monitoraggio non pianificato"),
  );

  const shutdown = async (sig: string) => {
    log.info({ sig }, "worker: arresto");
    clearInterval(timer);
    await Promise.allSettled(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "worker: errore fatale");
  process.exit(1);
});
