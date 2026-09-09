import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/queue";
import type { ImportRowStatus, Prisma } from "@prisma/client";
import { COMPANY_FIELDS, type Mapping } from "./column-aliases";
import { suggestMapping } from "./column-aliases";
import { parsePreview } from "./parse";
import { deleteUpload, readUpload, saveUpload } from "./storage";

export { COMPANY_FIELDS, FIELD_LABELS, REQUIRED_FIELDS } from "./column-aliases";
export type { CompanyField, Mapping } from "./column-aliases";

export interface CreateBatchResult {
  batchId: string;
  encoding: string;
  delimiter: string;
  headers: string[];
  previewRows: string[][];
  totalDataRows: number;
  suggestedMapping: Mapping;
}

export async function createBatchFromUpload(
  originalName: string,
  buf: Buffer,
): Promise<CreateBatchResult> {
  if (buf.byteLength > env.MAX_UPLOAD_MB * 1024 * 1024) {
    throw new ValidationError(undefined, `File oltre ${env.MAX_UPLOAD_MB} MB`);
  }
  const preview = parsePreview(buf);
  if (preview.headers.length === 0 || preview.headers.every((h) => !h.trim())) {
    throw new ValidationError(undefined, "CSV senza riga di intestazione riconoscibile");
  }

  const storagePath = await saveUpload(originalName, buf);
  const batch = await db.importBatch.create({
    data: {
      originalFilename: originalName,
      storagePath,
      status: "MAPPING",
      detectedEncoding: preview.encoding,
      delimiter: preview.delimiter,
      totalRows: preview.totalDataRows,
    },
  });

  return {
    batchId: batch.id,
    encoding: preview.encoding,
    delimiter: preview.delimiter,
    headers: preview.headers,
    previewRows: preview.rows,
    totalDataRows: preview.totalDataRows,
    suggestedMapping: suggestMapping(preview.headers),
  };
}

function sanitizeMapping(input: unknown): Mapping {
  const out: Mapping = {};
  if (typeof input !== "object" || input === null) return out;
  const rec = input as Record<string, unknown>;
  for (const f of COMPANY_FIELDS) {
    const v = rec[f];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[f] = v;
  }
  return out;
}

export async function confirmAndEnqueue(batchId: string, rawMapping: unknown) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError("Import non trovato");
  if (batch.status !== "MAPPING" && batch.status !== "PENDING") {
    throw new ConflictError(
      "BATCH_NOT_MAPPING",
      `Import in stato ${batch.status}, non modificabile`,
    );
  }

  const mapping = sanitizeMapping(rawMapping);
  if (mapping.legalName == null) {
    throw new ValidationError(undefined, "Devi mappare almeno la Ragione sociale");
  }

  await db.importBatch.update({
    where: { id: batchId },
    data: {
      columnMapping: mapping as Prisma.InputJsonValue,
      status: "PROCESSING",
      startedAt: new Date(),
    },
  });

  const { jobId } = await enqueue(
    "import",
    "import.process",
    { batchId },
    { dedupeKey: `import.process:${batchId}` },
  );
  return { jobId };
}

export async function getBatch(batchId: string) {
  const b = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new NotFoundError("Import non trovato");
  return b;
}

export interface MappingContext {
  headers: string[];
  rows: string[][];
  suggestedMapping: Mapping;
  delimiter: string;
  encoding: string;
}

/** Batch + (se in fase di MAPPING) anteprima ricavata ri-parsando il file originale. */
export async function getMappingContext(
  batchId: string,
): Promise<{ batch: Awaited<ReturnType<typeof getBatch>>; preview: MappingContext | null }> {
  const batch = await getBatch(batchId);
  if (batch.status !== "MAPPING" && batch.status !== "PENDING") return { batch, preview: null };
  const buf = await readUpload(batch.storagePath);
  const p = parsePreview(buf);
  return {
    batch,
    preview: {
      headers: p.headers,
      rows: p.rows,
      suggestedMapping: suggestMapping(p.headers),
      delimiter: p.delimiter,
      encoding: p.encoding,
    },
  };
}

export function listBatches(take = 30) {
  return db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take });
}

export async function deleteBatch(batchId: string) {
  const b = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new NotFoundError("Import non trovato");
  if (b.status !== "PENDING" && b.status !== "MAPPING") {
    throw new ConflictError("BATCH_STARTED", "Import già avviato: non eliminabile");
  }
  await deleteUpload(b.storagePath);
  await db.importBatch.delete({ where: { id: batchId } });
}

export async function listRows(
  batchId: string,
  opts: { status?: ImportRowStatus; page?: number; pageSize?: number },
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const where: Prisma.ImportRowWhereInput = {
    batchId,
    ...(opts.status ? { status: opts.status } : {}),
  };
  const [data, total] = await Promise.all([
    db.importRow.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.importRow.count({ where }),
  ]);
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
