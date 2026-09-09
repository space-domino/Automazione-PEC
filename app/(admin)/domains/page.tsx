import { Badge } from "@/components/ui/badge";
import { ResetFilters, SearchInput, SelectFilter } from "@/components/ui/filter-controls";
import { EmptyRow, PageHeader, TableWrap } from "@/components/ui/page";
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

  const withFilters = (extra: Record<string, string>, drop: string[] = []) => {
    const u = new URLSearchParams();
    for (const k of FILTER_KEYS) if (sp[k] && !drop.includes(k)) u.set(k, sp[k] as string);
    for (const [k, v] of Object.entries(extra)) u.set(k, v);
    const qs = u.toString();
    return qs ? `/domains?${qs}` : "/domains";
  };
  const pageHref = (p: number) =>
    p > 1 ? withFilters({ page: String(p) }, ["page"]) : withFilters({}, ["page"]);
  const groupHref = (g: string) =>
    g === "all" ? withFilters({}, ["group", "page"]) : withFilters({ group: g }, ["page"]);

  const cm = res.availabilityCounts;

  return (
    <div>
      <PageHeader
        title="Domini"
        sub={`Disponibili ${cm.AVAILABLE ?? 0} · registrati ${cm.REGISTERED ?? 0} · da verificare ${
          (cm.UNKNOWN ?? 0) + (cm.ERROR ?? 0)
        }`}
        actions={<BulkCheckButton />}
      />

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--border)] pb-2 text-sm">
        {Object.entries(DOMAIN_GROUPS).map(([k, g]) => (
          <Link
            key={k}
            href={groupHref(k)}
            aria-current={k === res.groupKey ? "page" : undefined}
            className={
              k === res.groupKey
                ? "font-medium text-[var(--accent)]"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }
          >
            {g.label}
          </Link>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="cerca dominio…" />
        <SelectFilter paramKey="extension" label="Estensione" options={EXT_OPTS} />
        <SelectFilter paramKey="minRank" label="Rank" options={RANK_OPTS} />
        <ResetFilters keys={FILTER_KEYS} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th>Dominio</th>
            <th>Azienda</th>
            <th className="num">AI</th>
            <th className="num">Rank</th>
            <th>Disponibilità</th>
            <th>Stato</th>
            <th className="num">Azione</th>
          </tr>
        </thead>
        <tbody>
          {res.data.length === 0 && (
            <EmptyRow cols={7}>
              Nessun dominio. Importa un CSV di aziende e lancia la generazione dei candidati.
            </EmptyRow>
          )}
          {res.data.map((d) => (
            <tr key={d.id}>
              <td>
                <Link href={`/domains/${d.id}`} className="rowlink">
                  {d.fqdn}
                </Link>
              </td>
              <td className="max-w-[16rem] truncate text-sm">
                <Link href={`/companies/${d.company.id}`} className="hover:underline">
                  {d.company.legalName}
                </Link>
              </td>
              <td className="num text-sm">{d.aiScore ?? "–"}</td>
              <td className="num text-sm">{d.rankScore ?? "–"}</td>
              <td>
                <Badge value={d.availabilityResult} />
              </td>
              <td>
                <Badge value={d.status} />
              </td>
              <td className="num">
                {d.status === "AVAILABLE" ? (
                  <Link
                    href={`/domains/${d.id}`}
                    className="text-xs font-medium text-[var(--accent)] hover:underline"
                  >
                    Acquista →
                  </Link>
                ) : (
                  <CheckButton domainId={d.id} small />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <div className="mt-3">
        <Pagination
          page={res.page}
          totalPages={res.totalPages}
          total={res.total}
          hrefFor={pageHref}
        />
      </div>
    </div>
  );
}
