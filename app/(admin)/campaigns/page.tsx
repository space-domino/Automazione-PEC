import { Badge } from "@/components/ui/badge";
import { EmptyRow, PageHeader, TableWrap } from "@/components/ui/page";
import { listCampaigns } from "@/services/campaigns";
import { listPecTemplates } from "@/services/pec/templates";
import Link from "next/link";
import { NewCampaignForm } from "./new-campaign-form";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const [campaigns, templates] = [await listCampaigns(), await listPecTemplates()];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campagne"
        sub="Abbina una lista di aziende ai domini a catalogo e invia le PEC a lotto."
      />

      <NewCampaignForm templates={templates.map((t) => ({ name: t.name, isActive: t.isActive }))} />

      <TableWrap>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Template</th>
            <th className="num">Righe</th>
            <th className="num">Inviate</th>
            <th className="num">Conflitti</th>
            <th className="num">Fallite</th>
            <th>Stato</th>
            <th>Creata</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.length === 0 && (
            <EmptyRow cols={8}>Nessuna campagna ancora. Creane una sopra.</EmptyRow>
          )}
          {campaigns.map((c) => (
            <tr key={c.id} className="rowlink">
              <td>
                <Link href={`/campaigns/${c.id}`} className="hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="mono text-xs text-[var(--ink-soft)]">{c.templateName}</td>
              <td className="num text-sm">{c.total}</td>
              <td className="num text-sm text-[var(--ok)]">{c.counts.sent}</td>
              <td className="num text-sm text-[var(--warn)]">{c.counts.conflict}</td>
              <td className="num text-sm text-[var(--danger)]">{c.counts.failed}</td>
              <td>
                <Badge value={c.status} />
              </td>
              <td className="text-xs text-[var(--ink-soft)]">
                {c.createdAt.toLocaleString("it-IT")}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
