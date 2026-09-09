import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/page";
import { getDomainDetail } from "@/services/catalog/domains";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckButton } from "../availability-actions";
import { PurchaseActions } from "./purchase-actions";

export const dynamic = "force-dynamic";

const eur = (n: number | null) =>
  n == null
    ? "–"
    : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export default async function DomainDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getDomainDetail(id);
  if (!res) notFound();

  const { domain: d, transitions } = res;
  const comm = d.offer?.communications[0];
  const published =
    d.offer && ["OFFER_PUBLISHED", "PEC_DRAFT", "PEC_APPROVED", "PEC_SENT"].includes(d.status);

  const rows: Array<[string, ReactNode]> = [
    [
      "Azienda",
      <Link key="az" href={`/companies/${d.company.id}`} className="hover:underline">
        {d.company.legalName}
      </Link>,
    ],
    ["AI score / confidence", `${d.aiScore ?? "–"} / ${d.aiConfidence ?? "–"}`],
    ["Motivazione AI", d.aiReasoning ?? "–"],
    ["Rank", d.rankScore ?? "–"],
    [
      "Disponibilità",
      <span key="av">
        <Badge value={d.availabilityResult} />
        {d.availabilityCheckedAt && (
          <span className="ml-2 text-xs text-[var(--ink-faint)]">
            {d.availabilityCheckedAt.toLocaleString("it-IT")}
          </span>
        )}
      </span>,
    ],
    ["Provider verifica", d.availabilityProvider ?? "–"],
    ["Costo acquisto", eur(d.purchasePrice ? Number(d.purchasePrice) : null)],
    ["Registrar", d.registrar ?? "–"],
    ["Data acquisto", d.purchasedAt ? d.purchasedAt.toLocaleDateString("it-IT") : "–"],
    ["Prezzo di vendita", eur(d.sellingPrice ? Number(d.sellingPrice) : null)],
    ["Stato PEC", comm ? <Badge key="pec" value={comm.status} /> : "nessuna"],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/domains", label: "Domini" }}
        title={<span className="mono">{d.fqdn}</span>}
        sub={<Badge value={d.status} />}
        actions={<CheckButton domainId={d.id} />}
      />

      {published && d.offer && (
        <div className="panel border-[var(--accent)] bg-[var(--accent-soft)] p-4">
          <div className="text-sm font-medium text-[var(--accent)]">In vendita su spacedomino</div>
          <a
            href={d.offer.landingPageUrl}
            target="_blank"
            rel="noreferrer"
            className="mono mt-1 block text-[var(--accent)] hover:underline"
          >
            {d.offer.landingPageUrl}
          </a>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            Offerta a {eur(Number(d.offer.price))} · pubblicata automaticamente all'acquisto
          </div>
        </div>
      )}

      <PurchaseActions
        domainId={d.id}
        status={d.status}
        availabilityResult={d.availabilityResult}
        sellingPrice={d.sellingPrice ? Number(d.sellingPrice) : null}
      />

      <dl className="panel divide-y divide-[var(--border)] p-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-6 py-2 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-[var(--ink-soft)]">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>

      <Card title="Storico verifiche disponibilità">
        <table className="dtable">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Esito</th>
              <th>Provider</th>
              <th className="num">HTTP</th>
              <th className="num">ms</th>
              <th>Errore</th>
            </tr>
          </thead>
          <tbody>
            {d.availabilityChecks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[var(--ink-faint)]">
                  Nessuna verifica.
                </td>
              </tr>
            )}
            {d.availabilityChecks.map((a) => (
              <tr key={a.id}>
                <td className="text-xs text-[var(--ink-soft)]">
                  {a.checkedAt.toLocaleString("it-IT")}
                </td>
                <td>
                  <Badge value={a.result} />
                </td>
                <td className="text-xs">{a.provider}</td>
                <td className="num text-xs">{a.rawStatusCode ?? "–"}</td>
                <td className="num text-xs">{a.durationMs ?? "–"}</td>
                <td className="text-xs text-[var(--danger)]">{a.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Storico transizioni di stato">
        <table className="dtable">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Da → a</th>
              <th>Attore</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {transitions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[var(--ink-faint)]">
                  Nessuna transizione.
                </td>
              </tr>
            )}
            {transitions.map((t) => (
              <tr key={t.id}>
                <td className="text-xs text-[var(--ink-soft)]">
                  {t.createdAt.toLocaleString("it-IT")}
                </td>
                <td className="text-xs">
                  {t.fromStatus ?? "∅"} → <span className="font-medium">{t.toStatus}</span>
                </td>
                <td className="text-xs">{t.actorType}</td>
                <td className="text-xs text-[var(--ink-soft)]">{t.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
