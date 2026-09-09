import { Badge } from "@/components/ui/badge";
import { EmptyRow, Metric, PageHeader, TableWrap } from "@/components/ui/page";
import { listOrders } from "@/services/sales";

export const dynamic = "force-dynamic";

const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const res = await listOrders({
    orderStatus: sp.status,
    source: sp.source,
    q: sp.q,
    page: Number(sp.page) || 1,
  });
  const revenue = res.data.reduce((s, o) => s + Number(o.amount), 0);

  return (
    <div>
      <PageHeader title="Ordini" sub="Vendite rilevate dallo storefront o registrate a mano" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Ordini (totale)" value={res.total} />
        <Metric label="In pagina" value={res.data.length} />
        <Metric label="Incasso in pagina" value={eur(revenue)} accent />
        <Metric
          label="Da trasferire"
          value={res.data.filter((o) => o.orderStatus === "PAID").length}
        />
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th>Dominio</th>
            <th>Cliente</th>
            <th className="num">Importo</th>
            <th>Pagamento</th>
            <th>Ordine</th>
            <th>Origine</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {res.data.length === 0 && (
            <EmptyRow cols={7}>
              Nessun ordine. Arrivano dal job che legge le vendite di spacedomino, o via
              registrazione manuale.
            </EmptyRow>
          )}
          {res.data.map((o) => (
            <tr key={o.id}>
              <td className="mono">{o.domain.fqdn}</td>
              <td className="text-sm">{o.customerEmail}</td>
              <td className="num">{eur(Number(o.amount))}</td>
              <td>
                <Badge value={o.paymentStatus} />
              </td>
              <td>
                <Badge value={o.orderStatus} />
              </td>
              <td className="text-xs text-[var(--ink-soft)]">{o.source}</td>
              <td className="text-xs text-[var(--ink-soft)]">
                {(o.paidAt ?? o.createdAt).toLocaleDateString("it-IT")}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
