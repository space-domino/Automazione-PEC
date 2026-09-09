import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { listJobs } from "@/services/catalog/jobs";
import Link from "next/link";
import { RetryButton } from "./retry-button";

export const dynamic = "force-dynamic";

const STATUSES = ["QUEUED", "ACTIVE", "COMPLETED", "RETRYING", "FAILED", "DELAYED"];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const res = await listJobs({ queue: sp.queue, status: sp.status, page });

  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const k of ["queue", "status"]) if (sp[k]) u.set(k, sp[k] as string);
    if (p > 1) u.set("page", String(p));
    const qs = u.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };
  const statusHref = (s: string) => {
    const u = new URLSearchParams();
    if (sp.queue) u.set("queue", sp.queue);
    if (s) u.set("status", s);
    const qs = u.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Job</h1>

      <div className="flex flex-wrap gap-3 text-xs">
        <Link
          href={statusHref("")}
          className={!sp.status ? "font-semibold" : "text-neutral-500 hover:underline"}
        >
          Tutti
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={statusHref(s)}
            className={sp.status === s ? "font-semibold" : "text-neutral-500 hover:underline"}
          >
            {s} ({res.statusCounts[s] ?? 0})
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2">Coda</th>
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2 text-right">Tent.</th>
              <th className="px-3 py-2">Creato</th>
              <th className="px-3 py-2">Fine</th>
              <th className="px-3 py-2">Errore</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">
                  Nessun job.
                </td>
              </tr>
            )}
            {res.data.map((j) => (
              <tr key={j.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-xs">{j.queue}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{j.name}</td>
                <td className="px-3 py-1.5">
                  <Badge value={j.status} />
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                  {j.attempts}/{j.maxAttempts}
                </td>
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {j.createdAt.toLocaleString("it-IT")}
                </td>
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {j.finishedAt ? j.finishedAt.toLocaleTimeString("it-IT") : "–"}
                </td>
                <td className="px-3 py-1.5 max-w-[240px] truncate text-xs text-red-600">
                  {j.error ?? ""}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {j.status === "FAILED" && <RetryButton jobRecordId={j.id} />}
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
