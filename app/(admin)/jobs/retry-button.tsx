"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryButton({ jobRecordId }: { jobRecordId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    await fetch(`/api/jobs/${jobRecordId}/retry`, { method: "POST" }).catch(() => {});
    setTimeout(() => {
      router.refresh();
      setBusy(false);
    }, 1200);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
    >
      {busy ? "…" : "Riprova"}
    </button>
  );
}
