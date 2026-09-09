import { QUEUE_NAMES } from "@/lib/queue";
import { type ImportCounters, processImportBatch } from "@/services/ingestion/process";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

interface ImportJobData {
  batchId: string;
}

export function startImportWorker() {
  return createWorker<ImportJobData, ImportCounters>(
    QUEUE_NAMES.import,
    (job: Job<ImportJobData, ImportCounters>) => processImportBatch(job.data.batchId),
    { concurrency: 1 },
  );
}
