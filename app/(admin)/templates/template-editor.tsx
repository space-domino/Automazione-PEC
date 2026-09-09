"use client";

import { renderTemplate, templatePlaceholders } from "@/services/pec/render";
import { useMemo, useRef, useState } from "react";

// Valori di esempio per l'anteprima: mostrano il template "compilato" come apparirebbe in una PEC reale.
const SAMPLE: Record<string, string> = {
  domain: "eternaholding.it",
  offer_url: "https://spacedomino.it/domini/eternaholding-it",
  company_name: "Eterna Holding S.r.l.",
  price: "€ 499,00",
  seller_legal_name: "Space Domino S.R.L.",
  seller_contact: "dominoimprese@pec.net",
  optout_url: "https://spacedomino.it/api/opt-out?t=ESEMPIO",
};

export function TemplateEditor({
  initial,
}: {
  initial: { bodyHtml: string; subject: string };
}) {
  const [tab, setTab] = useState<"html" | "preview">("html");
  const [html, setHtml] = useState(initial.bodyHtml);
  const [subject, setSubject] = useState(initial.subject);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = html !== saved.bodyHtml || subject !== saved.subject;
  const preview = useMemo(() => renderTemplate(html, SAMPLE), [html]);
  const placeholders = useMemo(() => templatePlaceholders(html), [html]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/templates/pec", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bodyHtml: html, subject }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? "Errore nel salvataggio");
      setSaved({ bodyHtml: html, subject });
      setMsg({ ok: true, text: "Salvato." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(f: File) {
    const text = await f.text();
    setHtml(text);
    setMsg({
      ok: true,
      text: `Caricato ${f.name} (${text.length.toLocaleString("it-IT")} caratteri) — ricorda di salvare`,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 border-b border-[var(--border)]">
        {(
          [
            ["html", "HTML"],
            ["preview", "Anteprima"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm ${
              tab === k
                ? "border-[var(--accent)] font-medium text-[var(--accent)]"
                : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          {msg && (
            <span className={`text-xs ${msg.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
              {msg.text}
            </span>
          )}
          {dirty && <span className="text-xs text-[var(--warn)]">modifiche non salvate</span>}
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="btn btn-primary"
          >
            {busy ? "…" : "Salva"}
          </button>
        </div>
      </div>

      {tab === "html" && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">
              Oggetto della PEC
            </span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn btn-ghost"
            >
              Carica da file .html
            </button>
            <button
              type="button"
              onClick={() => {
                setHtml(saved.bodyHtml);
                setSubject(saved.subject);
                setMsg(null);
              }}
              disabled={!dirty}
              className="btn btn-ghost"
            >
              Ripristina
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".html,text/html"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = "";
              }}
            />
            <span className="text-xs text-[var(--ink-faint)]">
              Segnaposto:{" "}
              {placeholders.length ? (
                <span className="mono">{placeholders.join("  ")}</span>
              ) : (
                "nessuno"
              )}
            </span>
          </div>

          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="mono h-[60vh] w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
            placeholder="Incolla qui il codice HTML del template…"
          />
        </div>
      )}

      {tab === "preview" && (
        <div>
          <div className="mb-2 text-xs text-[var(--ink-faint)]">
            Anteprima con valori di esempio (dominio <span className="mono">eternaholding.it</span>
            ). I segnaposto <span className="mono">{"{{...}}"}</span> vengono sostituiti al momento
            dell'invio.
          </div>
          <iframe
            title="Anteprima PEC"
            srcDoc={preview}
            className="h-[70vh] w-full rounded-md border border-[var(--border)] bg-white"
          />
        </div>
      )}
    </div>
  );
}
