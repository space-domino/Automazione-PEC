"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CheckButton({ domainId, small }: { domainId: string; small?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    await fetch(`/api/domains/${domainId}/availability-check`, { method: "POST" }).catch(() => {});
    for (const d of [1500, 3000, 5000]) setTimeout(() => router.refresh(), d);
    setTimeout(() => setBusy(false), 6000);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={`rounded border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 ${
        small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm"
      }`}
    >
      {busy ? "…" : "Verifica"}
    </button>
  );
}

export function BulkCheckButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setState("busy");
    setMsg(null);
    const res = await fetch("/api/domains/bulk/availability-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pending: true }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg(j?.error?.message ?? "Errore");
      setState("idle");
      return;
    }
    setMsg(`${j.queued} verifiche accodate`);
    for (const d of [3000, 6000, 10_000]) setTimeout(() => router.refresh(), d);
    setTimeout(() => setState("idle"), 12_000);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state === "busy"}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {state === "busy" ? "In corso…" : "Verifica tutti i non conclusi"}
      </button>
      {msg && <span className="text-xs text-neutral-500">{msg}</span>}
    </div>
  );
}
