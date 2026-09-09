"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

interface Props {
  domainId: string;
  status: string;
  availabilityResult: string;
  sellingPrice: number | null;
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? "Errore");
  return j;
}

const CAN_PURCHASE = new Set(["DISCOVERED", "AVAILABLE", "PURCHASE_PENDING"]);
const CAN_DISCARD = new Set([
  "DISCOVERED",
  "AVAILABLE",
  "REGISTERED",
  "PURCHASE_PENDING",
  "PURCHASED",
]);
const CAN_PRICE = new Set(["AVAILABLE", "PURCHASE_PENDING", "PURCHASED", "OFFER_DRAFT"]);

export function PurchaseActions({ domainId, status, availabilityResult, sellingPrice }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "purchase" | "price" | "block" | "discard">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setBusy(false);
      setModal(null);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const isFinal = status === "TRANSFERRED";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {CAN_PURCHASE.has(status) && (
        <button
          type="button"
          onClick={() => setModal("purchase")}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          Segna come acquistato
        </button>
      )}
      {CAN_PRICE.has(status) && (
        <button
          type="button"
          onClick={() => setModal("price")}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Prezzo vendita{sellingPrice != null ? ` · €${sellingPrice}` : ""}
        </button>
      )}
      {CAN_DISCARD.has(status) && (
        <button
          type="button"
          onClick={() => setModal("discard")}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Scarta
        </button>
      )}
      {status === "DISCARDED" && (
        <button
          type="button"
          onClick={() => run(() => postJson(`/api/domains/${domainId}/reopen`))}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Riapri
        </button>
      )}
      {status === "BLOCKED" ? (
        <button
          type="button"
          onClick={() =>
            run(() =>
              postJson(`/api/domains/${domainId}/unblock`, {
                toStatus: "DISCOVERED",
                reason: "sblocco manuale",
              }),
            )
          }
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Sblocca
        </button>
      ) : (
        !isFinal && (
          <button
            type="button"
            onClick={() => setModal("block")}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          >
            Blocca
          </button>
        )
      )}

      {err && !modal && <span className="text-sm text-red-600">{err}</span>}

      {modal === "purchase" && (
        <Modal title="Segna come acquistato" onClose={() => setModal(null)}>
          <PurchaseForm
            busy={busy}
            err={err}
            needOverride={availabilityResult !== "AVAILABLE"}
            onSubmit={(body) =>
              run(() => postJson(`/api/domains/${domainId}/mark-purchased`, body))
            }
          />
        </Modal>
      )}
      {modal === "price" && (
        <Modal title="Prezzo di vendita" onClose={() => setModal(null)}>
          <PriceForm
            current={sellingPrice}
            busy={busy}
            err={err}
            onSubmit={(v) =>
              run(async () => {
                const res = await fetch(`/api/domains/${domainId}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ sellingPrice: v }),
                });
                const j = await res.json().catch(() => null);
                if (!res.ok) throw new Error(j?.error?.message ?? "Errore");
              })
            }
          />
        </Modal>
      )}
      {modal === "block" && (
        <Modal title="Blocca dominio" onClose={() => setModal(null)}>
          <ReasonForm
            cta="Blocca"
            busy={busy}
            err={err}
            onSubmit={(reason) => run(() => postJson(`/api/domains/${domainId}/block`, { reason }))}
          />
        </Modal>
      )}
      {modal === "discard" && (
        <Modal title="Scarta dominio" onClose={() => setModal(null)}>
          <ReasonForm
            cta="Scarta"
            optional
            busy={busy}
            err={err}
            onSubmit={(reason) =>
              run(() => postJson(`/api/domains/${domainId}/discard`, { reason }))
            }
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PurchaseForm({
  busy,
  err,
  needOverride,
  onSubmit,
}: {
  busy: boolean;
  err: string | null;
  needOverride: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          purchasePrice: Number(f.get("purchasePrice")),
          currency: "EUR",
          registrar: String(f.get("registrar") ?? ""),
          purchasedAt: String(f.get("purchasedAt") ?? today),
          purchaseNotes: String(f.get("purchaseNotes") ?? "") || undefined,
          override: f.get("override") === "on",
        });
      }}
    >
      <Field label="Costo di acquisto (€)">
        <input
          name="purchasePrice"
          type="number"
          step="0.01"
          min="0"
          required
          className={inputCls}
        />
      </Field>
      <Field label="Registrar">
        <input
          name="registrar"
          type="text"
          required
          placeholder="Aruba, Namecheap…"
          className={inputCls}
        />
      </Field>
      <Field label="Data acquisto">
        <input name="purchasedAt" type="date" defaultValue={today} className={inputCls} />
      </Field>
      <Field label="Note (opzionale)">
        <textarea name="purchaseNotes" rows={2} className={inputCls} />
      </Field>
      {needOverride && (
        <label className="flex items-center gap-2 text-xs text-amber-700">
          <input name="override" type="checkbox" />
          La disponibilità non è AVAILABLE: forza comunque
        </label>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "…" : "Conferma acquisto"}
      </button>
    </form>
  );
}

function PriceForm({
  current,
  busy,
  err,
  onSubmit,
}: {
  current: number | null;
  busy: boolean;
  err: string | null;
  onSubmit: (v: number) => void;
}) {
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const v = Number(new FormData(e.currentTarget).get("sellingPrice"));
        if (Number.isFinite(v) && v >= 0) onSubmit(v);
      }}
    >
      <Field label="Prezzo di vendita (€)">
        <input
          name="sellingPrice"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={current ?? ""}
          className={inputCls}
        />
      </Field>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "…" : "Salva"}
      </button>
    </form>
  );
}

function ReasonForm({
  cta,
  optional,
  busy,
  err,
  onSubmit,
}: {
  cta: string;
  optional?: boolean;
  busy: boolean;
  err: string | null;
  onSubmit: (reason: string) => void;
}) {
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(String(new FormData(e.currentTarget).get("reason") ?? ""));
      }}
    >
      <Field label={optional ? "Motivo (opzionale)" : "Motivo"}>
        <textarea name="reason" rows={2} required={!optional} className={inputCls} />
      </Field>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "…" : cta}
      </button>
    </form>
  );
}

const inputCls =
  "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-900";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: il campo di input è passato via children
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}
