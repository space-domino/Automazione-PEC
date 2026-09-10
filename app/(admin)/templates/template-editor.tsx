"use client";

import { renderTemplate, templatePlaceholders } from "@/services/pec/render";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

// Valori di esempio per l'anteprima: il template "compilato" come in una PEC reale.
const SAMPLE: Record<string, string> = {
  domain: "eternaholding.it",
  offer_url: "https://spacedomino.it/domini/eternaholding-it",
  company_name: "Eterna Holding S.r.l.",
  price: "49,99 €",
  list_price: "499,00 €",
  discount_pct: "90",
  seller_legal_name: "Space Domino S.R.L.",
  seller_contact: "dominoimprese@pec.net",
  optout_url: "https://spacedomino.it/api/opt-out?t=ESEMPIO",
};

const SKELETON =
  '<!DOCTYPE html>\n<html lang="it">\n<head><meta charset="utf-8" /></head>\n<body style="font-family:Arial,sans-serif">\n  <p>Ciao {{company_name}},</p>\n  <p>Il dominio <strong>{{domain}}</strong> è disponibile a {{price}}.</p>\n  <p><a href="{{offer_url}}">Vai alla pagina</a></p>\n  <p style="font-size:11px;color:#888">Inviato da {{seller_legal_name}} — <a href="{{optout_url}}">cancellati</a></p>\n</body>\n</html>\n';

type Current = {
  id: string;
  name: string;
  bodyHtml: string;
  subject: string;
  isActive: boolean;
};

export function TemplateEditor({ current }: { current: Current | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<"html" | "preview">("html");
  const [name, setName] = useState(current?.name ?? "");
  const [subject, setSubject] = useState(current?.subject ?? "");
  const [html, setHtml] = useState(current?.bodyHtml ?? SKELETON);
  const [saved, setSaved] = useState({
    name: current?.name ?? "",
    subject: current?.subject ?? "",
    html: current?.bodyHtml ?? SKELETON,
  });
  const [busy, setBusy] = useState<null | "save" | "activate" | "delete" | "new">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = !current || html !== saved.html || subject !== saved.subject || name !== saved.name;
  const preview = useMemo(() => renderTemplate(html, SAMPLE), [html]);
  const placeholders = useMemo(() => templatePlaceholders(`${subject} ${html}`), [subject, html]);

  async function req(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
    return j;
  }

  async function save() {
    if (!current) return;
    setBusy("save");
    setMsg(null);
    try {
      await req(`/api/templates/pec/${current.id}`, "PUT", { name, bodyHtml: html, subject });
      setSaved({ name, subject, html });
      setMsg({ ok: true, text: "Salvato." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function activate() {
    if (!current) return;
    setBusy("activate");
    setMsg(null);
    try {
      await req(`/api/templates/pec/${current.id}/activate`, "POST");
      setMsg({ ok: true, text: "Template attivato." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    if (!current) return;
    setBusy("delete");
    setMsg(null);
    try {
      await req(`/api/templates/pec/${current.id}`, "DELETE");
      router.push("/templates");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setBusy(null);
    }
  }

  async function create() {
    const n = newName.trim();
    if (!n) return;
    setBusy("new");
    setMsg(null);
    try {
      const t = await req("/api/templates/pec", "POST", {
        name: n,
        bodyHtml: current ? html : SKELETON,
        subject: current ? subject : "",
      });
      setCreating(false);
      setNewName("");
      router.push(`/templates?t=${t.id}`);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
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
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mono rounded-md border border-[var(--border-strong)] bg-white px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
              style={{ width: `${Math.max(12, name.length + 2)}ch` }}
            />
            {current.isActive ? (
              <span className="chip text-[11px] text-[var(--ok)]">attivo</span>
            ) : (
              <button
                type="button"
                onClick={activate}
                disabled={busy !== null}
                className="btn btn-ghost px-2 py-1 text-xs"
              >
                {busy === "activate" ? "…" : "Attiva"}
              </button>
            )}
          </>
        ) : (
          <span className="text-sm text-[var(--ink-faint)]">Nessun template selezionato</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {msg && (
            <span className={`text-xs ${msg.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
              {msg.text}
            </span>
          )}
          {current && dirty && (
            <span className="text-xs text-[var(--warn)]">modifiche non salvate</span>
          )}
          {creating ? (
            <>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="nome nuovo template"
                className="rounded-md border border-[var(--border-strong)] bg-white px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={create}
                disabled={busy !== null || !newName.trim()}
                className="btn btn-primary px-2 py-1 text-xs"
              >
                {busy === "new" ? "…" : "Crea"}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="btn btn-ghost px-2 py-1 text-xs"
              >
                Annulla
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn btn-ghost px-2 py-1 text-xs"
            >
              {current ? "Nuovo / duplica" : "Nuovo"}
            </button>
          )}
          {current && (
            <button
              type="button"
              onClick={save}
              disabled={busy !== null || !dirty}
              className="btn btn-primary"
            >
              {busy === "save" ? "…" : "Salva"}
            </button>
          )}
        </div>
      </div>

      {current && (
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
          {!current.isActive && (
            <button
              type="button"
              onClick={del}
              disabled={busy !== null}
              className="ml-auto text-xs text-[var(--danger)] hover:underline"
            >
              {busy === "delete" ? "…" : "Elimina template"}
            </button>
          )}
        </div>
      )}

      {current && tab === "html" && (
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

          <div className="flex flex-wrap items-center gap-2">
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
                setHtml(saved.html);
                setSubject(saved.subject);
                setName(saved.name);
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

      {current && tab === "preview" && (
        <div>
          <div className="mb-2 text-xs text-[var(--ink-faint)]">
            Anteprima con valori di esempio (dominio <span className="mono">eternaholding.it</span>,
            listino <span className="mono">499,00 €</span> → promo{" "}
            <span className="mono">49,99 €</span>). I segnaposto{" "}
            <span className="mono">{"{{...}}"}</span> vengono sostituiti all'invio.
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
