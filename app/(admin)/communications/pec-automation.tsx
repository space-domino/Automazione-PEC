"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function Switch({
  on,
  busy,
  disabled,
  onClick,
}: {
  on: boolean;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy || disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function PecAutomation({
  initial,
}: {
  initial: { autoCompose: boolean; autoSend: boolean };
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<null | "autoCompose" | "autoSend">(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(key: "autoCompose" | "autoSend") {
    const next = { ...state, [key]: !state[key] };
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch("/api/settings/pec", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
      setState({ autoCompose: j.autoCompose, autoSend: j.autoSend });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel mb-4 space-y-3 p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Bozza automatica</div>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
            Alla pubblicazione dell'offerta, prepara la bozza PEC personalizzata con dominio e link
            alla pagina di vendita di quel cliente.
          </p>
        </div>
        <Switch
          on={state.autoCompose}
          busy={busy === "autoCompose"}
          onClick={() => toggle("autoCompose")}
        />
      </div>

      <div className="flex items-start justify-between gap-4 border-t border-[var(--border)] pt-3">
        <div>
          <div className="text-sm font-medium">Invio automatico</div>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
            {state.autoSend
              ? "La bozza viene approvata e spedita da sola, senza passare dall'approvazione manuale."
              : "Le bozze restano in attesa di approvazione manuale (consigliato)."}
            {!state.autoCompose && " Richiede la bozza automatica attiva."}
          </p>
        </div>
        <Switch
          on={state.autoSend}
          busy={busy === "autoSend"}
          disabled={!state.autoCompose}
          onClick={() => toggle("autoSend")}
        />
      </div>

      {err && <p className="text-xs text-[var(--danger)]">{err}</p>}
    </div>
  );
}
