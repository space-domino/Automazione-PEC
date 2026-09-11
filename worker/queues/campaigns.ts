import { QUEUE_NAMES } from "@/lib/queue";
import { runCampaignSend } from "@/services/campaigns";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

interface CampaignJobData {
  campaignId: string;
  actorUserId: string | null;
}

export function startCampaignsWorker() {
  return createWorker<CampaignJobData, void>(
    QUEUE_NAMES.campaigns,
    (job: Job<CampaignJobData, void>) =>
      runCampaignSend(job.data.campaignId, { userId: job.data.actorUserId ?? undefined }),
    { concurrency: 1 },
  );
}
