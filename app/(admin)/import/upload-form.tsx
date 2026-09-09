"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UploadForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const f = input?.files?.[0];
    if (!f) return;
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error?.message ?? "Upload fallito");
      return;
    }
    const j = await res.json();
    router.push(`/import/${j.batchId}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white p-4"
    >
      <input
        type="file"
        name="file"
        accept=".csv,text/csv,text/plain"
        required
        className="text-sm"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Caricamento…" : "Carica"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
