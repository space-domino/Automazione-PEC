"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function NewCampaignForm({
  templates,
}: {
  templates: { name: string; isActive: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [companiesText, setCompaniesText] = useState("");
  const [templateName, setTemplateName] = useState(
    templates.find((t) => t.isActive)?.name ?? templates[0]?.name ?? "",
  );
  const [promoPrice, setPromoPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFile(f: File) {
    setCompaniesText(await f.text());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          companiesText,
          templateName,
          promoPrice: promoPrice ? Number(promoPrice) : undefined,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
      router.push(`/campaigns/${j.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        + Nuova campagna
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Nuova campagna</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--ink-faint)] hover:text-[var(--ink)]"
        >
          annulla
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">
            Nome campagna
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="es. Offerte settembre"
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">
            Template PEC
          </span>
          <select
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            required
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.isActive ? " (attivo)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">
            Prezzo promo (opzionale)
          </span>
          <input
            value={promoPrice}
            onChange={(e) => setPromoPrice(e.target.value)}
            placeholder="es. 49.99 — lascia vuoto per usare pec.promo_price"
            className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      <label className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            Aziende — una per riga: ragione sociale, provincia, PEC (tab, `;` o `,`)
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="btn btn-ghost px-2 py-1 text-xs"
          >
            Carica da file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <textarea
          value={companiesText}
          onChange={(e) => setCompaniesText(e.target.value)}
          required
          spellCheck={false}
          placeholder={
            "Ragione sociale\tProvincia\tPEC\nOMEGA HOLDING S.R.L.\tAgrigento\tomega@pec.it"
          }
          className="mono h-48 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
        />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Abbinamento in corso…" : "Abbina al catalogo"}
        </button>
        {err && <span className="text-xs text-[var(--danger)]">{err}</span>}
      </div>
    </form>
  );
}
