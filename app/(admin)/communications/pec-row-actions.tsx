"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SENDABLE = new Set(["DRAFT", "APPROVED", "QUEUED", "FAILED"]);
const CANCELLABLE = new Set(["DRAFT", "APPROVED", "QUEUED", "FAILED", "PAUSED"]);

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
  return j;
}

export function PecRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "send" | "cancel">(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (kind: "send" | "cancel", fn: () => Promise<unknown>) => {
    setBusy(kind);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = () =>
    run("send", async () => {
      if (status === "DRAFT") await post(`/api/communications/${id}/approve`);
      // niente ?sync=1: l'invio SMTP lo fa il worker `pec`, mai il processo web.
      await post(`/api/communications/${id}/send`);
    });
  const cancel = () =>
    run("cancel", () =>
      post(`/api/communications/${id}/cancel`, { reason: "annullata dalla console" }),
    );

  if (!SENDABLE.has(status) && !CANCELLABLE.has(status)) {
    return <span className="text-xs text-[var(--ink-faint)]">–</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {err && <span className="text-xs text-[var(--danger)]">{err}</span>}
      {SENDABLE.has(status) && (
        <button
          type="button"
          onClick={send}
          disabled={busy !== null}
          className="btn btn-primary px-2 py-1 text-xs"
        >
          {busy === "send" ? "…" : status === "DRAFT" ? "Approva e invia" : "Invia"}
        </button>
      )}
      {CANCELLABLE.has(status) && (
        <button
          type="button"
          onClick={cancel}
          disabled={busy !== null}
          className="btn btn-ghost px-2 py-1 text-xs"
        >
          {busy === "cancel" ? "…" : "Annulla"}
        </button>
      )}
    </div>
  );
}
