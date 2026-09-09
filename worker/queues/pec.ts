import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { pollReceipts, sendApprovedPec } from "@/services/pec";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

interface PecJobData {
  communicationId?: string;
}

/**
 * Coda `pec`:
 *  - `pec.receipts.poll`: legge la casella IMAP PEC e archivia le ricevute (M9).
 *  - `pec.send`: invio della PEC approvata (M10 — non ancora registrato qui).
 *
 * No-op se `features.pec` è falso o manca l'host IMAP.
 */
export function startPecWorker() {
  return createWorker<PecJobData, unknown>(
    QUEUE_NAMES.pec,
    async (job: Job<PecJobData>) => {
      if (job.name === "pec.receipts.poll") {
        return pollReceipts({ requestId: `job:${job.id}` });
      }
      if (job.name === "pec.send") {
        if (!job.data.communicationId) throw new Error("pec.send senza communicationId");
        return sendApprovedPec(job.data.communicationId, { requestId: `job:${job.id}` });
      }
      throw new Error(`job pec sconosciuto: ${job.name}`);
    },
    { concurrency: 1 },
  );
}

/** Job ripetibile: ogni 5 min raccoglie le ricevute PEC. */
export async function scheduleReceiptsPoll(): Promise<void> {
  await getQueue(QUEUE_NAMES.pec).add(
    "pec.receipts.poll",
    {},
    {
      repeat: { every: 5 * 60_000 },
      jobId: "pec.receipts.poll",
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}
