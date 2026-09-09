import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { scanForAlerts } from "@/services/monitoring/alerts";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

/**
 * Coda `monitoring`: job `monitoring.scan` ripetibile — esegue i check di
 * salute/rischio e genera le notifiche (M12). Sempre attiva.
 */
export function startMonitoringWorker() {
  return createWorker<Record<string, never>, unknown>(
    QUEUE_NAMES.monitoring,
    async (job: Job) => {
      if (job.name === "monitoring.scan") return scanForAlerts();
      throw new Error(`job monitoring sconosciuto: ${job.name}`);
    },
    { concurrency: 1 },
  );
}

/** Job ripetibile: scan ogni 15 min. */
export async function scheduleMonitoringScan(): Promise<void> {
  await getQueue(QUEUE_NAMES.monitoring).add(
    "monitoring.scan",
    {},
    {
      repeat: { every: 15 * 60_000 },
      jobId: "monitoring.scan",
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}
