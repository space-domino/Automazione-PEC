import { Badge } from "@/components/ui/badge";
import { ResetFilters, SearchInput, SelectFilter } from "@/components/ui/filter-controls";
import { Pagination } from "@/components/ui/pagination";
import { DOMAIN_GROUPS, listDomains } from "@/services/catalog/domains";
import Link from "next/link";
import { BulkCheckButton, CheckButton } from "./availability-actions";

export const dynamic = "force-dynamic";

const EXT_OPTS = ["it", "com", "net", "org", "eu", "io"].map((v) => ({ value: v, label: `.${v}` }));
const RANK_OPTS = [
  { value: "50", label: "≥ 50" },
  { value: "70", label: "≥ 70" },
  { value: "85", label: "≥ 85" },
];
const FILTER_KEYS = ["group", "extension", "minRank", "q"];

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;

  const res = await listDomains({
    group: sp.group,
    extension: sp.extension,
    minRank: sp.minRank ? Number.parseInt(sp.minRank, 10) : undefined,
    q: sp.q,
    page,
  });

  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const k of FILTER_KEYS) if (sp[k]) u.set(k, sp[k] as string);
    if (p > 1) u.set("page", String(p));
    const qs = u.toString();
    return qs ? `/domains?${qs}` : "/domains";
  };
  const groupHref = (g: string) => {
    const u = new URLSearchParams();
    for (const k of ["extension", "minRank", "q"]) if (sp[k]) u.set(k, sp[k] as string);
    if (g !== "all") u.set("group", g);
    const qs = u.toString();
    return qs ? `/domains?${qs}` : "/domains";
  };

  const cm = res.availabilityCounts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Domini</h1>
          <p className="text-sm text-neutral-500">
            Disponibili {cm.AVAILABLE ?? 0} · registrati {cm.REGISTERED ?? 0} · da concludere{" "}
            {(cm.UNKNOWN ?? 0) + (cm.ERROR ?? 0)}
          </p>
        </div>
        <BulkCheckButton />
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(DOMAIN_GROUPS).map(([k, g]) => (
          <Link
            key={k}
            href={groupHref(k)}
            className={k === res.groupKey ? "font-semibold" : "text-neutral-500 hover:underline"}
          >
            {g.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="fqdn…" />
        <SelectFilter paramKey="extension" label="Estensione" options={EXT_OPTS} />
        <SelectFilter paramKey="minRank" label="Rank" options={RANK_OPTS} />
        <ResetFilters keys={FILTER_KEYS} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">Dominio</th>
              <th className="px-3 py-2">Azienda</th>
              <th className="px-3 py-2 text-right">AI</th>
              <th className="px-3 py-2 text-right">Rank</th>
              <th className="px-3 py-2">Disponibilità</th>
              <th className="px-3 py-2">Verificato</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                  Nessun dominio.
                </td>
              </tr>
            )}
            {res.data.map((d) => (
              <tr
                key={d.id}
                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
              >
                <td className="px-3 py-1.5 font-mono text-xs">
                  <Link href={`/domains/${d.id}`} className="text-blue-700 hover:underline">
                    {d.fqdn}
                  </Link>
                </td>
                <td className="px-3 py-1.5">
                  <Link
                    href={`/companies/${d.company.id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {d.company.legalName}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{d.aiScore ?? "–"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{d.rankScore ?? "–"}</td>
                <td className="px-3 py-1.5">
                  <Badge value={d.availabilityResult} />
                </td>
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {d.availabilityCheckedAt ? d.availabilityCheckedAt.toLocaleString("it-IT") : "–"}
                </td>
                <td className="px-3 py-1.5">
                  <Badge value={d.status} />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <CheckButton domainId={d.id} small />
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
