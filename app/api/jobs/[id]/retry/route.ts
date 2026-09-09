import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { type QueueName, getQueue } from "@/lib/queue";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params }) => {
    const rec = await db.jobRecord.findUnique({ where: { id: params.id } });
    if (!rec) throw new NotFoundError("Job non trovato");
    if (rec.status !== "FAILED") {
      throw new ConflictError(
        "NOT_FAILED",
        `Job in stato ${rec.status}: solo i FAILED si ritentano`,
      );
    }

    const newKey = `${rec.dedupeKey ?? rec.bullJobId}:retry:${Date.now()}`;
    await getQueue(rec.queue as QueueName).add(rec.name, (rec.payload ?? {}) as object, {
      jobId: newKey,
    });
    await db.jobRecord.create({
      data: {
        queue: rec.queue,
        name: rec.name,
        bullJobId: newKey,
        dedupeKey: newKey,
        status: "QUEUED",
        payload: (rec.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        maxAttempts: rec.maxAttempts,
      },
    });

    return Response.json({ ok: true, jobId: newKey }, { status: 202 });
  },
  { auth: "admin" },
);
