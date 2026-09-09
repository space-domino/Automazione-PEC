import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { importCompanyRow } from "@/services/company-registry";
import { enqueueDiscoveryForCompanies } from "@/services/domain-discovery";
import type { ImportRowStatus, Prisma } from "@prisma/client";
import type { CompanyField, Mapping } from "./column-aliases";
import { forEachRow } from "./parse";
import { readUpload } from "./storage";

export interface ImportCounters {
  imported: number;
  duplicate: number;
  skipped: number;
  error: number;
}

async function refreshCounters(batchId: string): Promise<ImportCounters> {
  const grouped = await db.importRow.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });
  const c: ImportCounters = { imported: 0, duplicate: 0, skipped: 0, error: 0 };
  for (const g of grouped) {
    if (g.status === "IMPORTED") c.imported = g._count._all;
    else if (g.status === "DUPLICATE") c.duplicate = g._count._all;
    else if (g.status === "SKIPPED") c.skipped = g._count._all;
    else if (g.status === "ERROR") c.error = g._count._all;
  }
  await db.importBatch.update({
    where: { id: batchId },
    data: {
      importedCount: c.imported,
      duplicateCount: c.duplicate,
      skippedCount: c.skipped,
      errorCount: c.error,
    },
  });
  return c;
}

/**
 * Elabora un ImportBatch riga per riga (D — Fase 2).
 * Idempotente: le righe già presenti come ImportRow (run precedente) vengono saltate;
 * i contatori sono RICALCOLATI da ImportRow, mai incrementati alla cieca.
 */
export async function processImportBatch(batchId: string): Promise<ImportCounters> {
  const log = logger.child({ batchId, job: "import.process" });

  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`ImportBatch ${batchId} non trovato`);

  const mapping = (batch.columnMapping ?? {}) as Mapping;
  if (mapping.legalName == null) throw new Error("mapping privo di legalName");

  const buf = await readUpload(batch.storagePath);
  const format = {
    encoding: batch.detectedEncoding ?? "utf-8",
    delimiter: batch.delimiter ?? ",",
  };

  const alreadyDone = new Set(
    (await db.importRow.findMany({ where: { batchId }, select: { rowNumber: true } })).map(
      (r) => r.rowNumber,
    ),
  );

  let processed = 0;

  await forEachRow(buf, format, async (row, rowNumber, headers) => {
    if (alreadyDone.has(rowNumber)) return;

    const rawObj: Record<string, string> = {};
    row.forEach((cell, i) => {
      rawObj[headers[i] || `col${i + 1}`] = cell;
    });

    const pick = (f: CompanyField): string | null => {
      const idx = mapping[f];
      if (idx == null) return null;
      const v = (row[idx] ?? "").trim();
      return v || null;
    };

    const legalName = pick("legalName");
    let status: ImportRowStatus = "SKIPPED";
    let companyId: string | null = null;
    let message: string | null = null;
    let normalizedData: Prisma.InputJsonValue | undefined;

    try {
      if (!legalName) {
        message = "Ragione sociale mancante";
      } else {
        const outcome = await importCompanyRow(
          {
            legalName,
            vatNumber: pick("vatNumber"),
            pec: pick("pec"),
            province: pick("province"),
            website: pick("website"),
            sector: pick("sector"),
          },
          rawObj as Prisma.InputJsonValue,
          batchId,
        );
        companyId = outcome.companyId;
        normalizedData = outcome.normalized as unknown as Prisma.InputJsonValue;
        status = outcome.kind === "created" ? "IMPORTED" : "DUPLICATE";
        if (outcome.kind === "duplicate") message = "Azienda già presente";
      }
    } catch (err) {
      status = "ERROR";
      message = (err as Error).message.slice(0, 500);
      log.error({ err, rowNumber }, "riga in errore");
    }

    await db.importRow
      .create({
        data: {
          batchId,
          rowNumber,
          rawData: rawObj as Prisma.InputJsonValue,
          normalizedData,
          status,
          companyId,
          message,
        },
      })
      .catch((e) => log.error({ e, rowNumber }, "ImportRow.create fallita"));

    processed++;
    if (processed % 100 === 0) await refreshCounters(batchId);
  });

  const counts = await refreshCounters(batchId);
  const finalStatus = counts.error > 0 ? "PARTIAL" : "COMPLETED";
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: finalStatus, finishedAt: new Date() },
  });

  await db.notification.create({
    data: {
      type: "import.completed",
      title: `Import "${batch.originalFilename}" completato`,
      body: `${counts.imported} importate · ${counts.duplicate} duplicate · ${counts.skipped} scartate · ${counts.error} errori`,
      severity: counts.error > 0 ? "WARN" : "INFO",
      data: { batchId, ...counts } as Prisma.InputJsonValue,
    },
  });

  // D — Fase 4: discovery automatica per le aziende appena create (no-op se AI non configurata).
  try {
    const rows = await db.importRow.findMany({
      where: { batchId, status: "IMPORTED", companyId: { not: null } },
      select: { companyId: true },
    });
    const companyIds = rows.map((r) => r.companyId).filter((x): x is string => Boolean(x));
    const queued = await enqueueDiscoveryForCompanies(companyIds);
    if (queued > 0) log.info({ queued }, "import.process: discovery accodata");
  } catch (err) {
    log.warn({ err }, "import.process: enqueue discovery fallito (import comunque ok)");
  }

  log.info(counts, "import.process: completato");
  return counts;
}
