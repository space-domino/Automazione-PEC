import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { listActivity } from "@/services/catalog/activity";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ENTITY_TYPES = ["Domain", "Company", "Offer", "Communication", "Order"];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const res = await listActivity({ entityType: sp.entityType, entityId: sp.entityId, page });

  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const k of ["entityType", "entityId"]) if (sp[k]) u.set(k, sp[k] as string);
    if (p > 1) u.set("page", String(p));
    const qs = u.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };
  const typeHref = (t: string) => {
    const u = new URLSearchParams();
    if (t) u.set("entityType", t);
    if (sp.entityId) u.set("entityId", sp.entityId);
    const qs = u.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit</h1>
        <p className="text-sm text-neutral-500">
          Transizioni di stato e azioni registrate (chi/quando/cosa).
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <Link
          href={typeHref("")}
          className={!sp.entityType ? "font-semibold" : "text-neutral-500 hover:underline"}
        >
          Tutti
        </Link>
        {ENTITY_TYPES.map((t) => (
          <Link
            key={t}
            href={typeHref(t)}
            className={sp.entityType === t ? "font-semibold" : "text-neutral-500 hover:underline"}
          >
            {t}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Entità</th>
              <th className="px-3 py-2">Attore</th>
              <th className="px-3 py-2">Dettaglio</th>
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-400">
                  Nessuna attività registrata.
                </td>
              </tr>
            )}
            {res.data.map((it) => (
              <tr key={it.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {it.createdAt.toLocaleString("it-IT")}
                </td>
                <td className="px-3 py-1.5">
                  <Badge value={it.kind === "transition" ? "transition" : "audit"} muted />
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {it.entityType === "Domain" ? (
                    <Link
                      href={`/domains/${it.entityId}`}
                      className="text-blue-700 hover:underline"
                    >
                      {it.entityType}
                    </Link>
                  ) : it.entityType === "Company" ? (
                    <Link
                      href={`/companies/${it.entityId}`}
                      className="text-blue-700 hover:underline"
                    >
                      {it.entityType}
                    </Link>
                  ) : (
                    it.entityType
                  )}
                  <span className="ml-1 text-neutral-400">{it.entityId.slice(0, 8)}</span>
                </td>
                <td className="px-3 py-1.5 text-xs">{it.actor}</td>
                <td className="px-3 py-1.5 text-xs text-neutral-600">{it.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={res.page} totalPages={res.totalPages} total={res.total} hrefFor={href} />
    </div>
  );
}
