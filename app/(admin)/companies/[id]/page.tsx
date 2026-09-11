import { db } from "@/lib/db";
import { features } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckButton } from "../../domains/availability-actions";
import { DiscoveryButton } from "./discovery-button";
import { EstimateDomainButton } from "./estimate-domain-button";

export const dynamic = "force-dynamic";

const AVAIL_STYLES: Record<string, string> = {
  AVAILABLE: "text-green-700",
  REGISTERED: "text-neutral-500",
  UNKNOWN: "text-neutral-400",
  ERROR: "text-red-700",
};

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await db.company.findUnique({ where: { id } });
  if (!company || company.deletedAt) notFound();

  const domains = await db.domain.findMany({
    where: { companyId: id, deletedAt: null },
    orderBy: [{ rankScore: "desc" }, { aiScore: "desc" }, { createdAt: "asc" }],
  });

  const fields: Array<[string, string | null]> = [
    ["Ragione sociale", company.legalName],
    ["Nome normalizzato", company.normalizedName],
    ["Provincia", company.provinceName ?? company.province],
    ["PEC", company.pec],
    ["P.IVA", company.vatNumber],
    ["Sito web", company.website],
    ["Settore", company.sector],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/companies" className="text-xs text-neutral-500 hover:underline">
          ← Aziende
        </Link>
        <h1 className="text-xl font-semibold">{company.legalName}</h1>
        {company.isBlocked && (
          <p className="text-sm text-red-600">Azienda bloccata: {company.blockedReason}</p>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-2">
        {fields.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-right">{v || "–"}</dd>
          </div>
        ))}
      </dl>

      {features.ai && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Stima automatica</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Combina i dati dell'azienda con una ricerca web su attività simili, propone UN dominio e
            ne verifica subito la disponibilità reale (WHOIS/RDAP).
          </p>
          <EstimateDomainButton companyId={id} />
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">
            Domini candidati ({domains.length})
          </h2>
          {features.ai ? (
            <DiscoveryButton
              companyId={id}
              label={domains.length ? "Rigenera domini" : "Genera domini"}
            />
          ) : (
            <span className="text-xs text-amber-700">
              AI non configurata (ANTHROPIC_API_KEY mancante in .env)
            </span>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2">Dominio</th>
                <th className="px-3 py-2 text-right">AI score</th>
                <th className="px-3 py-2 text-right">Confidence</th>
                <th className="px-3 py-2 text-right">Rank</th>
                <th className="px-3 py-2">Disponibilità</th>
                <th className="px-3 py-2">Stato</th>
                <th className="px-3 py-2">Motivazione AI</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {domains.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                    Nessun candidato. {features.ai ? "Usa “Genera domini”." : ""}
                  </td>
                </tr>
              )}
              {domains.map((d) => (
                <tr key={d.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{d.fqdn}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.aiScore ?? "–"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.aiConfidence ?? "–"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.rankScore ?? "–"}</td>
                  <td className={`px-3 py-2 text-xs ${AVAIL_STYLES[d.availabilityResult] ?? ""}`}>
                    {d.availabilityResult}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{d.status}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{d.aiReasoning}</td>
                  <td className="px-3 py-2 text-right">
                    <CheckButton domainId={d.id} small />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
