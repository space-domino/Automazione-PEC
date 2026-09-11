import { db } from "@/lib/db";
import type { JobStatus, Prisma } from "@prisma/client";

export interface JobListParams {
  queue?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listJobs(p: JobListParams) {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, p.pageSize ?? 50));

  const where: Prisma.JobRecordWhereInput = {};
  if (p.queue) where.queue = p.queue;
  if (p.status) where.status = p.status as JobStatus;

  // in sequenza, non Promise.all: vedi companies.ts per il perché.
  const data = await db.jobRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const total = await db.jobRecord.count({ where });
  const byStatus = await db.jobRecord.groupBy({ by: ["status"], _count: { _all: true } });

  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<
      string,
      number
    >,
  };
}
