"use client";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import type { CampaignDetail as CampaignDetailType, CampaignRow } from "@/services/campaigns";
import { useEffect, useRef, useState } from "react";

const CONF_LABEL: Record<string, string> = {
  alta: "alta",
  media: "media",
  bassa: "bassa",
  nessuno: "nessuno",
  manuale: "manuale",
};

export function CampaignDetail({ initial }: { initial: CampaignDetailType }) {
  const [c, setC] = useState(initial);
  const [sendBusy, setSendBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (c.status !== "SENDING") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/campaigns/${c.id}`);
      if (res.ok) setC(await res.json());
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [c.status, c.id]);

  async function saveRow(row: CampaignRow) {
    const raw = (drafts[row.row] ?? (row.domain ? `${row.domain}${row.tld ?? ""}` : "")).trim();
    setSavingRow(row.row);
    setErr(null);
    try {
      let domain: string | null = null;
      let tld: string | null = null;
      if (raw) {
        const dot = raw.lastIndexOf(".");
        domain = (dot > 0 ? raw.slice(0, dot) : raw).toLowerCase();
        tld = (dot > 0 ? raw.slice(dot) : ".it").toLowerCase();
      }
      const res = await fetch(`/api/campaigns/${c.id}/rows/${row.row}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, tld }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
      setC(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingRow(null);
    }
  }

  async function send() {
    setSendBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/campaigns/${c.id}/send`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Errore ${res.status}`);
      setC(j);
      setConfirming(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSendBusy(false);
    }
  }

  const editable = c.status === "MATCHED";
  const progressDone = c.counts.sent + c.counts.conflict + c.counts.failed + c.counts.skipped;
  const noDomain = c.rows.filter((r) => !r.domain).length;
  const conflicts = c.counts.conflict;

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.name}
        sub={`Template ${c.templateName}${c.promoPrice ? ` · promo ${c.promoPrice.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}` : ""}`}
        actions={<Badge value={c.status} />}
      />

      <div className="panel grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-5">
        <div>
          <div className="text-xs text-[var(--ink-faint)]">Righe totali</div>
          <div className="text-lg font-semibold">{c.total}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--ink-faint)]">Inviate</div>
          <div className="text-lg font-semibold text-[var(--ok)]">{c.counts.sent}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--ink-faint)]">Conflitti</div>
          <div className="text-lg font-semibold text-[var(--warn)]">{c.counts.conflict}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--ink-faint)]">Fallite</div>
          <div className="text-lg font-semibold text-[var(--danger)]">{c.counts.failed}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--ink-faint)]">Scartate</div>
          <div className="text-lg font-semibold text-[var(--ink-soft)]">{c.counts.skipped}</div>
        </div>
      </div>

      {c.status === "SENDING" && (
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--ink-soft)]">
            <span>Invio in corso — la pagina si aggiorna da sola</span>
            <span>
              {progressDone} / {c.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${c.total ? (progressDone / c.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {editable && (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          {conflicts > 0 && (
            <span className="text-xs text-[var(--danger)]">
              {conflicts} righe in conflitto: dominio già assegnato ad altra azienda — non verranno
              inviate.
            </span>
          )}
          {noDomain > 0 && (
            <span className="text-xs text-[var(--warn)]">
              {noDomain} righe senza dominio: verranno saltate.
            </span>
          )}
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className="btn btn-primary">
              Invia campagna
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm">Confermi l'invio di {c.total - noDomain} PEC?</span>
              <button type="button" onClick={send} disabled={sendBusy} className="btn btn-primary">
                {sendBusy ? "Avvio…" : "Sì, invia"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost">
                Annulla
              </button>
            </div>
          )}
          {err && <span className="text-xs text-[var(--danger)]">{err}</span>}
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="dtable">
          <thead>
            <tr>
              <th>#</th>
              <th>Ragione sociale</th>
              <th>Provincia</th>
              <th>PEC</th>
              <th>Dominio</th>
              <th>Confidenza</th>
              <th>Stato</th>
              <th>Dettaglio</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.row}>
                <td className="num text-xs text-[var(--ink-faint)]">{r.row}</td>
                <td className="text-sm">{r.legalName}</td>
                <td className="text-xs text-[var(--ink-soft)]">{r.province}</td>
                <td className="mono text-xs text-[var(--ink-soft)]">{r.pec}</td>
                <td>
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <input
                        defaultValue={r.domain ? `${r.domain}${r.tld ?? ""}` : ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.row]: e.target.value }))}
                        placeholder="dominio.it"
                        className="mono w-40 rounded border border-[var(--border-strong)] bg-white px-1.5 py-0.5 text-xs outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => saveRow(r)}
                        disabled={savingRow === r.row}
                        className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
                      >
                        {savingRow === r.row ? "…" : "salva"}
                      </button>
                    </div>
                  ) : (
                    <span className="mono text-xs">
                      {r.domain ? `${r.domain}${r.tld ?? ""}` : "–"}
                    </span>
                  )}
                </td>
                <td className="text-xs">{CONF_LABEL[r.confidence] ?? r.confidence}</td>
                <td>
                  <Badge value={r.status} />
                </td>
                <td
                  className="max-w-xs truncate text-xs text-[var(--ink-faint)]"
                  title={r.detail ?? ""}
                >
                  {r.detail ?? "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
