import { QUEUE_NAMES } from "@/lib/queue";
import { type DiscoveryOutcome, discoverForCompany } from "@/services/domain-discovery";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

interface DiscoveryJobData {
  companyId: string;
  force?: boolean;
}

export function startDiscoveryWorker() {
  return createWorker<DiscoveryJobData, DiscoveryOutcome>(
    QUEUE_NAMES.discovery,
    (job: Job<DiscoveryJobData, DiscoveryOutcome>) =>
      discoverForCompany(job.data.companyId, { force: job.data.force }),
    { concurrency: 3 },
  );
}
