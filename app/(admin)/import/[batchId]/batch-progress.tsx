"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface BatchState {
  status: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  skippedCount: number;
  errorCount: number;
}

const DONE = new Set(["COMPLETED", "PARTIAL", "FAILED"]);

export function BatchProgress({ batchId, initial }: { batchId: string; initial: BatchState }) {
  const router = useRouter();
  const [state, setState] = useState<BatchState>(initial);

  useEffect(() => {
    if (DONE.has(initial.status)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/import/${batchId}`, { cache: "no-store" });
        if (!alive || !res.ok) return;
        const b: BatchState = await res.json();
        setState(b);
        if (DONE.has(b.status)) {
          router.refresh();
          return;
        }
      } catch {
        // riprova al giro dopo
      }
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [batchId, initial.status, router]);

  const done = state.importedCount + state.duplicateCount + state.skippedCount + state.errorCount;
  const pct = state.totalRows > 0 ? Math.min(100, Math.round((done / state.totalRows) * 100)) : 0;
  const running = !DONE.has(state.status);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">Stato: {state.status}</span>
        {running && <span className="text-neutral-400">aggiornamento…</span>}
      </div>
      {running && (
        <div className="mb-3 h-2 w-full overflow-hidden rounded bg-neutral-100">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="grid grid-cols-4 gap-3 text-center text-sm">
        <Stat label="Importate" value={state.importedCount} className="text-green-700" />
        <Stat label="Duplicate" value={state.duplicateCount} />
        <Stat label="Scartate" value={state.skippedCount} className="text-amber-700" />
        <Stat label="Errori" value={state.errorCount} className="text-red-700" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  className = "",
}: { label: string; value: number; className?: string }) {
  return (
    <div>
      <div
        data-testid={`count-${label}`}
        className={`text-lg font-semibold tabular-nums ${className}`}
      >
        {value}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
