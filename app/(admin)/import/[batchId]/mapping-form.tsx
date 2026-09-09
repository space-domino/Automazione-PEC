"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "legalName", label: "Ragione sociale", required: true },
  { key: "vatNumber", label: "Partita IVA" },
  { key: "pec", label: "PEC" },
  { key: "province", label: "Provincia" },
  { key: "website", label: "Sito web" },
  { key: "sector", label: "Settore" },
];

export function MappingForm({
  batchId,
  headers,
  rows,
  suggested,
}: {
  batchId: string;
  headers: string[];
  rows: string[][];
  suggested: Record<string, number>;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<Record<string, number | "">>(() => {
    const m: Record<string, number | ""> = {};
    for (const f of FIELDS) m[f.key] = suggested[f.key] ?? "";
    return m;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mapping.legalName === "") {
      setError("Devi mappare la Ragione sociale");
      return;
    }
    setLoading(true);
    setError(null);
    const payload: Record<string, number> = {};
    for (const [k, v] of Object.entries(mapping)) if (v !== "") payload[k] = v as number;

    const res = await fetch(`/api/import/${batchId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: payload }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error?.message ?? "Errore");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700">
              {f.label}
              {f.required && <span className="text-red-500"> *</span>}
            </span>
            <select
              value={mapping[f.key]}
              onChange={(e) =>
                setMapping((m) => ({
                  ...m,
                  [f.key]: e.target.value === "" ? "" : Number(e.target.value),
                }))
              }
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">— non mappato —</option>
              {headers.map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: colonne posizionali (nomi anche duplicati/vuoti)
                <option key={i} value={i}>
                  {h || `Colonna ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              {headers.map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: colonne posizionali
                <th key={i} className="whitespace-nowrap px-2 py-1.5">
                  {h || `Col ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((r, ri) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: righe di anteprima statiche
              <tr key={ri} className="border-b border-neutral-100 last:border-0">
                {headers.map((_, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: celle posizionali
                  <td key={ci} className="px-2 py-1 text-neutral-600">
                    {r[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Avvio…" : "Conferma e importa"}
      </button>
    </form>
  );
}
