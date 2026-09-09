import { Badge } from "@/components/ui/badge";
import { EmptyRow, PageHeader, TableWrap } from "@/components/ui/page";
import { listOffers } from "@/services/offers";
import Link from "next/link";

export const dynamic = "force-dynamic";

const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const res = await listOffers({ status: sp.status, q: sp.q, page: Number(sp.page) || 1 });
  const published = res.data.filter((o) => o.status === "PUBLISHED").length;

  return (
    <div>
      <PageHeader
        title="Offerte"
        sub={`${res.total} in totale · ${published} pubblicate su questa pagina`}
      />
      <TableWrap>
        <thead>
          <tr>
            <th>Dominio</th>
            <th>Azienda</th>
            <th className="num">Prezzo</th>
            <th>Stato</th>
            <th>Pagina di vendita</th>
            <th>Aggiornata</th>
          </tr>
        </thead>
        <tbody>
          {res.data.length === 0 && (
            <EmptyRow cols={6}>
              Nessuna offerta. Segna un dominio come acquistato: l'offerta viene creata e pubblicata
              da sola.
            </EmptyRow>
          )}
          {res.data.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/domains/${o.domain.id}`} className="rowlink">
                  {o.domain.fqdn}
                </Link>
              </td>
              <td className="text-sm">{o.company.legalName}</td>
              <td className="num">{eur(Number(o.price))}</td>
              <td>
                <Badge value={o.status} />
              </td>
              <td>
                <a
                  href={o.landingPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[var(--accent)] hover:underline"
                >
                  {o.landingPageUrl.replace(/^https?:\/\//, "")}
                </a>
              </td>
              <td className="text-xs text-[var(--ink-soft)]">
                {o.updatedAt.toLocaleString("it-IT")}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
