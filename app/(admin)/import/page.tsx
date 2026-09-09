import { listBatches } from "@/services/ingestion";
import Link from "next/link";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-neutral-100 text-neutral-700",
  MAPPING: "bg-amber-100 text-amber-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  PARTIAL: "bg-orange-100 text-orange-800",
  FAILED: "bg-red-100 text-red-800",
};

export default async function ImportPage() {
  const batches = await listBatches();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Import CSV</h1>
        <p className="text-sm text-neutral-500">
          Carica un CSV di aziende: riconoscimento colonne, normalizzazione (forme societarie,
          accenti, province, P.IVA), deduplica.
        </p>
      </div>

      <UploadForm />

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-700">Import recenti</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Stato</th>
                <th className="px-3 py-2 text-right">Righe</th>
                <th className="px-3 py-2 text-right">Import.</th>
                <th className="px-3 py-2 text-right">Dup.</th>
                <th className="px-3 py-2 text-right">Scart.</th>
                <th className="px-3 py-2 text-right">Err.</th>
                <th className="px-3 py-2">Data</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                    Nessun import.
                  </td>
                </tr>
              )}
              {batches.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-3 py-2">
                    <Link href={`/import/${b.id}`} className="text-blue-700 hover:underline">
                      {b.originalFilename}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status] ?? ""}`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.totalRows}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">
                    {b.importedCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.duplicateCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.skippedCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">{b.errorCount}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {b.createdAt.toLocaleString("it-IT")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
