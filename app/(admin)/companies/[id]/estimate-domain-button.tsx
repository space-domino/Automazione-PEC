"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface EstimateResult {
  fqdn: string;
  available: boolean;
  availabilityResult: string;
  confidence: number;
  reasoning: string;
  researchNotes: string;
}

export function EstimateDomainButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/estimate-domain`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
      setResult(j);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Ricerca web + stima in corso…" : "Stima dominio (AI + ricerca web)"}
        </button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>

      {result && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            result.available
              ? "border-green-200 bg-green-50 text-green-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="font-mono font-medium">
            {result.fqdn}{" "}
            {result.available ? (
              <span className="font-sans font-normal">— libero, pronto per l'acquisto</span>
            ) : (
              <span className="font-sans font-normal">
                — già{" "}
                {result.availabilityResult === "REGISTERED" ? "registrato" : "non risulta libero"}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs opacity-80">
            confidenza {result.confidence}% — {result.reasoning}
          </div>
          {result.researchNotes && (
            <div className="mt-1 text-xs opacity-70">ricerca web: {result.researchNotes}</div>
          )}
        </div>
      )}
    </div>
  );
}
