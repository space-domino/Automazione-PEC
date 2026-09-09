import { Badge } from "@/components/ui/badge";
import { ResetFilters, SearchInput, SelectFilter } from "@/components/ui/filter-controls";
import { Pagination } from "@/components/ui/pagination";
import { PROVINCES } from "@/lib/geo/province";
import { listCompanies } from "@/services/catalog/companies";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PROV_OPTS = Object.entries(PROVINCES).map(([code, name]) => ({
  value: code,
  label: `${code} — ${name}`,
}));
const DOMAIN_STATUS_OPTS = [
  "DISCOVERED",
  "AVAILABLE",
  "REGISTERED",
  "PURCHASED",
  "OFFER_PUBLISHED",
  "PEC_SENT",
  "SOLD",
].map((v) => ({ value: v, label: v }));
const AVAIL_OPTS = ["AVAILABLE", "REGISTERED", "UNKNOWN", "ERROR"].map((v) => ({
  value: v,
  label: v,
}));

const FILTER_KEYS = ["q", "province", "domainStatus", "availability", "hasPec", "sort"];

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;

  const res = await listCompanies({
    q: sp.q,
    province: sp.province,
    domainStatus: sp.domainStatus,
    availability: sp.availability,
    hasPec: sp.hasPec === "1" ? true : sp.hasPec === "0" ? false : undefined,
    sort: sp.sort,
    page,
  });

  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const k of FILTER_KEYS) if (sp[k]) u.set(k, sp[k] as string);
    if (p > 1) u.set("page", String(p));
    const qs = u.toString();
    return qs ? `/companies?${qs}` : "/companies";
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Aziende</h1>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Ragione sociale, P.IVA…" />
        <SelectFilter paramKey="province" label="Provincia" options={PROV_OPTS} />
        <SelectFilter paramKey="domainStatus" label="Stato dominio" options={DOMAIN_STATUS_OPTS} />
        <SelectFilter paramKey="availability" label="Disponibilità" options={AVAIL_OPTS} />
        <SelectFilter
          paramKey="hasPec"
          label="PEC"
          options={[
            { value: "1", label: "presente" },
            { value: "0", label: "assente" },
          ]}
        />
        <ResetFilters keys={FILTER_KEYS} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">Azienda</th>
              <th className="px-3 py-2">Prov.</th>
              <th className="px-3 py-2">PEC</th>
              <th className="px-3 py-2">Dominio migliore</th>
              <th className="px-3 py-2 text-right">AI/Rank</th>
              <th className="px-3 py-2">Disponibilità</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2 text-right">#dom</th>
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                  Nessuna azienda.
                </td>
              </tr>
            )}
            {res.data.map((c) => (
              <tr
                key={c.id}
                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
              >
                <td className="px-3 py-2">
                  <Link href={`/companies/${c.id}`} className="text-blue-700 hover:underline">
                    {c.legalName}
                  </Link>
                  {c.isBlocked && (
                    <span className="ml-2">
                      <Badge value="BLOCKED" />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{c.province ?? "–"}</td>
                <td className="px-3 py-2 text-neutral-600">{c.pec ?? "–"}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.topDomain?.fqdn ?? "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.topDomain?.rankScore ?? c.topDomain?.aiScore ?? "–"}
                </td>
                <td className="px-3 py-2">
                  {c.topDomain ? <Badge value={c.topDomain.availabilityResult} /> : "–"}
                </td>
                <td className="px-3 py-2">
                  {c.topDomain ? <Badge value={c.topDomain.status} /> : "–"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                  {c.domainCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={res.page} totalPages={res.totalPages} total={res.total} hrefFor={href} />
    </div>
  );
}
