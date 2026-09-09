import { Badge } from "@/components/ui/badge";
import { EmptyRow, PageHeader, TableWrap } from "@/components/ui/page";
import { listCommunications } from "@/services/pec";
import { PecRowActions } from "./pec-row-actions";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const res = await listCommunications({ status: sp.status, q: sp.q, page: Number(sp.page) || 1 });

  return (
    <div>
      <PageHeader
        title="PEC"
        sub={`${res.total} comunicazioni · bozza → approvata → inviata → ricevute`}
      />
      <TableWrap>
        <thead>
          <tr>
            <th>Destinatario</th>
            <th>Oggetto</th>
            <th>Offerta</th>
            <th>Stato</th>
            <th className="num">Ricevute</th>
            <th>Inviata</th>
            <th className="num">Azione</th>
          </tr>
        </thead>
        <tbody>
          {res.data.length === 0 && (
            <EmptyRow cols={7}>
              Nessuna PEC. Alla pubblicazione di un'offerta la bozza viene preparata in automatico,
              personalizzata con dominio e link alla pagina di vendita.
            </EmptyRow>
          )}
          {res.data.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.recipient}</td>
              <td className="max-w-xs truncate text-sm" title={c.subject}>
                {c.subject}
              </td>
              <td className="mono text-xs text-[var(--ink-soft)]">{c.offer?.slug ?? "–"}</td>
              <td>
                <Badge value={c.status} />
              </td>
              <td className="num text-sm">{c.receipts.length}</td>
              <td className="text-xs text-[var(--ink-soft)]">
                {c.sentAt ? c.sentAt.toLocaleString("it-IT") : "–"}
              </td>
              <td className="num">
                <PecRowActions id={c.id} status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
