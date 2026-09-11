import type { Prisma } from "@prisma/client";
import { type JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Infrastruttura code (sezione A.5 / D).
 * Connessione dedicata a BullMQ (maxRetriesPerRequest: null obbligatorio),
 * separata dal client cache/rate-limit di lib/redis.ts.
 *
 * lazyConnect: si collega SOLO al primo comando (add/worker), non all'import
 * -> `next build` non tenta connessioni verso un Redis assente.
 */
export const bullConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

bullConnection.on("error", (err) => {
  logger.debug({ err: err.message }, "bullmq redis: error");
});

export const QUEUE_NAMES = {
  import: "import",
  discovery: "discovery",
  availability: "availability",
  storefront: "storefront",
  pec: "pec",
  monitoring: "monitoring",
  campaigns: "campaigns",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, q);
  }
  return q;
}

export interface EnqueueOptions {
  /** Diventa il jobId BullMQ -> un secondo enqueue con la stessa chiave è un no-op (idempotenza). */
  dedupeKey: string;
  jobOptions?: JobsOptions;
}

export interface EnqueueResult {
  jobId: string;
  recordId: string;
}

/** Accoda un job e ne rispecchia lo stato in JobRecord (per la dashboard, sezione 28). */
export async function enqueue<T extends Record<string, unknown>>(
  name: QueueName,
  jobName: string,
  data: T,
  opts: EnqueueOptions,
): Promise<EnqueueResult> {
  const q = getQueue(name);
  // BullMQ vieta ":" nei jobId custom (è il separatore delle chiavi Redis).
  // Il dedupeKey "logico" resta salvato su JobRecord per la tracciabilità.
  const jobId = opts.dedupeKey.replace(/:/g, "-");
  const job = await q.add(jobName, data, { jobId, ...opts.jobOptions });
  const bullJobId = job.id ?? jobId;

  const record = await db.jobRecord.upsert({
    where: { bullJobId },
    create: {
      queue: name,
      name: jobName,
      bullJobId,
      dedupeKey: opts.dedupeKey,
      status: "QUEUED",
      payload: data as Prisma.InputJsonValue,
      maxAttempts: Number(opts.jobOptions?.attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 3),
    },
    update: { status: "QUEUED", error: null },
  });

  return { jobId: bullJobId, recordId: record.id };
}
