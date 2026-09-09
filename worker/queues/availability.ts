import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { enqueueStaleAvailability, runAvailabilityForDomain } from "@/services/availability";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

interface AvailJobData {
  domainId?: string;
  force?: boolean;
}

export function startAvailabilityWorker() {
  return createWorker<AvailJobData, unknown>(
    QUEUE_NAMES.availability,
    async (job: Job<AvailJobData>) => {
      if (job.name === "availability.recheck") {
        const requeued = await enqueueStaleAvailability();
        return { requeued };
      }
      if (!job.data.domainId) throw new Error("availability.check senza domainId");
      return runAvailabilityForDomain(job.data.domainId, { force: job.data.force });
    },
    { concurrency: 3 },
  );
}

/** Job ripetibile: ogni 6h ri-accoda i domini con verifica scaduta/mancante. */
export async function scheduleAvailabilityRecheck(): Promise<void> {
  await getQueue(QUEUE_NAMES.availability).add(
    "availability.recheck",
    {},
    {
      repeat: { every: 6 * 3600_000 },
      jobId: "availability.recheck",
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}
