"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DiscoveryButton({ companyId, label }: { companyId: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setState("running");
    setMsg(null);
    const res = await fetch(`/api/companies/${companyId}/discovery`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setState("error");
      setMsg(j?.error?.message ?? "Errore");
      return;
    }
    // il worker genera i candidati in modo asincrono: ricarichiamo qualche volta
    for (const delay of [3000, 4000, 5000, 8000]) {
      setTimeout(() => router.refresh(), delay);
    }
    setTimeout(() => setState("idle"), 20_000);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {state === "running" ? "Generazione in corso…" : label}
      </button>
      {state === "running" && (
        <span className="text-xs text-neutral-400">
          la generazione è asincrona, la pagina si aggiorna da sola
        </span>
      )}
      {state === "error" && <span className="text-sm text-red-600">{msg}</span>}
    </div>
  );
}
