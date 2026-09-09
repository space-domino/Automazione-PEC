import { Badge } from "@/components/ui/badge";
import { EmptyRow, PageHeader, TableWrap } from "@/components/ui/page";
import { listTransfers } from "@/services/transfer";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STAGES = [
  { key: "", label: "Tutti" },
  { key: "to_start", label: "Da avviare" },
  { key: "in_progress", label: "In corso" },
  { key: "failed", label: "Falliti" },
  { key: "done", label: "Conclusi" },
] as const;

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const stage = (sp.stage ?? "") as "" | "to_start" | "in_progress" | "failed" | "done";
  const res = await listTransfers({
    stage: stage || undefined,
    q: sp.q,
    page: Number(sp.page) || 1,
  });

  return (
    <div>
      <PageHeader title="Trasferimenti" sub="Consegna del dominio al cliente dopo la vendita" />
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {STAGES.map((s) => (
          <Link
            key={s.key}
            href={s.key ? `/transfers?stage=${s.key}` : "/transfers"}
            className={
              stage === s.key
                ? "font-semibold text-[var(--accent)]"
                : "text-[var(--ink-soft)] hover:underline"
            }
          >
            {s.label}
          </Link>
        ))}
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th>Dominio</th>
            <th>Cliente</th>
            <th>Metodo</th>
            <th>Authcode</th>
            <th>Stato ordine</th>
            <th>Stato dominio</th>
            <th>Avviato</th>
          </tr>
        </thead>
        <tbody>
          {res.data.length === 0 && (
            <EmptyRow cols={7}>Nessun trasferimento in questo stato.</EmptyRow>
          )}
          {res.data.map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.domain.fqdn}</td>
              <td className="text-sm">{t.customerEmail}</td>
              <td className="text-xs text-[var(--ink-soft)]">{t.transferMethod ?? "–"}</td>
              <td className="text-xs">
                {t.hasAuthCode ? (
                  <span className="text-[var(--ok)]">salvato</span>
                ) : (
                  <span className="text-[var(--ink-faint)]">–</span>
                )}
              </td>
              <td>
                <Badge value={t.orderStatus} />
              </td>
              <td>
                <Badge value={t.domain.status} />
              </td>
              <td className="text-xs text-[var(--ink-soft)]">
                {t.transferStartedAt ? t.transferStartedAt.toLocaleString("it-IT") : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
