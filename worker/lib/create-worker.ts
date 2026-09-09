import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { bullConnection } from "@/lib/queue";
import type { Prisma } from "@prisma/client";
import { type Job, type Processor, Worker } from "bullmq";

/**
 * Crea un Worker BullMQ che tiene aggiornato il relativo JobRecord
 * (ACTIVE -> COMPLETED / RETRYING / FAILED) e logga in modo strutturato.
 */
export function createWorker<T = unknown, R = unknown>(
  queueName: string,
  processor: (job: Job<T, R>) => Promise<R>,
  opts: { concurrency?: number } = {},
): Worker<T, R> {
  const log = logger.child({ worker: queueName });

  const wrapped: Processor<T, R> = async (job) => {
    const bullJobId = job.id ?? "";
    await db.jobRecord.updateMany({
      where: { bullJobId },
      data: {
        status: "ACTIVE",
        startedAt: new Date(),
        attempts: job.attemptsMade + 1,
        error: null,
      },
    });
    log.info({ jobId: bullJobId, name: job.name }, "job: start");

    const result = await processor(job);

    await db.jobRecord.updateMany({
      where: { bullJobId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        result: (result ?? {}) as Prisma.InputJsonValue,
      },
    });
    log.info({ jobId: bullJobId }, "job: done");
    return result;
  };

  const worker = new Worker<T, R>(queueName, wrapped, {
    connection: bullConnection,
    concurrency: opts.concurrency ?? 1,
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    const willRetry = job.attemptsMade < (job.opts.attempts ?? 1);
    void db.jobRecord
      .updateMany({
        where: { bullJobId: job.id ?? "" },
        data: {
          status: willRetry ? "RETRYING" : "FAILED",
          error: err.message.slice(0, 2000),
          finishedAt: willRetry ? null : new Date(),
        },
      })
      .catch(() => {});
    log.error({ jobId: job.id, attempt: job.attemptsMade, err: err.message }, "job: failed");
  });

  worker.on("error", (err) => log.error({ err }, "worker: error"));

  return worker;
}
