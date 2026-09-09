import { Badge } from "@/components/ui/badge";
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

  const rows: Array<[string, ReactNode]> = [
    [
      "Azienda",
      <Link key="az" href={`/companies/${d.company.id}`} className="text-blue-700 hover:underline">
        {d.company.legalName}
      </Link>,
    ],
    [
      "Dominio",
      <span key="d" className="font-mono">
        {d.fqdn}
      </span>,
    ],
    ["AI score", d.aiScore ?? "–"],
    ["AI confidence", d.aiConfidence ?? "–"],
    ["Motivazione AI", d.aiReasoning ?? "–"],
    ["Rank score", d.rankScore ?? "–"],
    [
      "Disponibilità",
      <span key="av">
        <Badge value={d.availabilityResult} />
        {d.availabilityCheckedAt && (
          <span className="ml-2 text-xs text-neutral-400">
            {d.availabilityCheckedAt.toLocaleString("it-IT")}
          </span>
        )}
      </span>,
    ],
    ["Provider verifica", d.availabilityProvider ?? "–"],
    ["Stato", <Badge key="st" value={d.status} />],
    ["Costo acquisto", eur(d.purchasePrice ? Number(d.purchasePrice) : null)],
    ["Registrar", d.registrar ?? "–"],
    ["Data acquisto", d.purchasedAt ? d.purchasedAt.toLocaleDateString("it-IT") : "–"],
    ["Prezzo vendita", eur(d.sellingPrice ? Number(d.sellingPrice) : null)],
    [
      "Pagina di vendita",
      d.offer ? (
        <a key="lp" href={d.offer.landingPageUrl} className="text-blue-700 hover:underline">
          {d.offer.landingPageUrl}
        </a>
      ) : (
        "non ancora creata"
      ),
    ],
    ["Stato PEC", comm ? <Badge key="pec" value={comm.status} /> : "nessuna comunicazione"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/domains" className="text-xs text-neutral-500 hover:underline">
            ← Domini
          </Link>
          <h1 className="font-mono text-xl font-semibold">{d.fqdn}</h1>
        </div>
        <CheckButton domainId={d.id} />
      </div>

      <PurchaseActions
        domainId={d.id}
        status={d.status}
        availabilityResult={d.availabilityResult}
        sellingPrice={d.sellingPrice ? Number(d.sellingPrice) : null}
      />

      <dl className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-6 border-b border-neutral-50 py-1.5 last:border-0"
          >
            <dt className="shrink-0 text-neutral-500">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>

      <Section title="Storico verifiche disponibilità">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Esito</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2 text-right">HTTP</th>
              <th className="px-3 py-2 text-right">ms</th>
              <th className="px-3 py-2">Errore</th>
            </tr>
          </thead>
          <tbody>
            {d.availabilityChecks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-neutral-400">
                  Nessuna verifica.
                </td>
              </tr>
            )}
            {d.availabilityChecks.map((a) => (
              <tr key={a.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {a.checkedAt.toLocaleString("it-IT")}
                </td>
                <td className="px-3 py-1.5">
                  <Badge value={a.result} />
                </td>
                <td className="px-3 py-1.5 text-xs">{a.provider}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                  {a.rawStatusCode ?? "–"}
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                  {a.durationMs ?? "–"}
                </td>
                <td className="px-3 py-1.5 text-xs text-red-600">{a.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Storico transizioni di stato">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Da → A</th>
              <th className="px-3 py-2">Attore</th>
              <th className="px-3 py-2">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {transitions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-neutral-400">
                  Nessuna transizione.
                </td>
              </tr>
            )}
            {transitions.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {t.createdAt.toLocaleString("it-IT")}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {t.fromStatus ?? "∅"} → <span className="font-medium">{t.toStatus}</span>
                </td>
                <td className="px-3 py-1.5 text-xs">{t.actorType}</td>
                <td className="px-3 py-1.5 text-xs text-neutral-500">{t.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-neutral-700">{title}</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        {children}
      </div>
    </div>
  );
}
