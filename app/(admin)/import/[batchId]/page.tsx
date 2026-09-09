import { getMappingContext, listRows } from "@/services/ingestion";
import type { ImportRowStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchProgress } from "./batch-progress";
import { MappingForm } from "./mapping-form";

export const dynamic = "force-dynamic";

const ROW_STYLES: Record<string, string> = {
  IMPORTED: "text-green-700",
  DUPLICATE: "text-neutral-500",
  SKIPPED: "text-amber-700",
  ERROR: "text-red-700",
};
const ROW_STATUSES: ImportRowStatus[] = ["IMPORTED", "DUPLICATE", "SKIPPED", "ERROR"];

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ rowStatus?: string; page?: string }>;
}) {
  const { batchId } = await params;
  const sp = await searchParams;

  let ctx: Awaited<ReturnType<typeof getMappingContext>>;
  try {
    ctx = await getMappingContext(batchId);
  } catch {
    notFound();
  }
  const { batch, preview } = ctx;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/import" className="text-xs text-neutral-500 hover:underline">
          ← Import
        </Link>
        <h1 className="text-xl font-semibold">{batch.originalFilename}</h1>
        <p className="text-sm text-neutral-500">
          {batch.detectedEncoding} · separatore &quot;{batch.delimiter}&quot; · {batch.totalRows}{" "}
          righe
        </p>
      </div>

      {preview ? (
        <MappingForm
          batchId={batchId}
          headers={preview.headers}
          rows={preview.rows}
          suggested={preview.suggestedMapping as Record<string, number>}
        />
      ) : (
        <>
          <BatchProgress
            batchId={batchId}
            initial={{
              status: batch.status,
              totalRows: batch.totalRows,
              importedCount: batch.importedCount,
              duplicateCount: batch.duplicateCount,
              skippedCount: batch.skippedCount,
              errorCount: batch.errorCount,
            }}
          />
          <RowsTable
            batchId={batchId}
            rowStatus={sp.rowStatus}
            page={Number.parseInt(sp.page ?? "1", 10) || 1}
          />
        </>
      )}
    </div>
  );
}

async function RowsTable({
  batchId,
  rowStatus,
  page,
}: {
  batchId: string;
  rowStatus?: string;
  page: number;
}) {
  const status =
    rowStatus && (ROW_STATUSES as string[]).includes(rowStatus)
      ? (rowStatus as ImportRowStatus)
      : undefined;
  const { data, total, totalPages } = await listRows(batchId, { status, page });

  return (
    <div>
      <div className="mb-2 flex gap-3 text-xs">
        <Link
          href={`/import/${batchId}`}
          className={!status ? "font-semibold" : "text-neutral-500 hover:underline"}
        >
          Tutte
        </Link>
        {ROW_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/import/${batchId}?rowStatus=${s}`}
            className={status === s ? "font-semibold" : "text-neutral-500 hover:underline"}
          >
            {s}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2">Messaggio</th>
              <th className="px-3 py-2">Dati grezzi</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
                  Nessuna riga.
                </td>
              </tr>
            )}
            {data.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 tabular-nums text-neutral-500">{r.rowNumber}</td>
                <td className={`px-3 py-1.5 text-xs font-medium ${ROW_STYLES[r.status] ?? ""}`}>
                  {r.status}
                </td>
                <td className="px-3 py-1.5 text-neutral-600">{r.message}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-neutral-400">
                  {JSON.stringify(r.rawData).slice(0, 140)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        {total} righe · pagina {page}/{totalPages}
      </p>
    </div>
  );
}
