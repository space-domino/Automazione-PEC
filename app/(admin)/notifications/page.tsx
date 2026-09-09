import { Badge } from "@/components/ui/badge";
import { EmptyRow, PageHeader, TableWrap } from "@/components/ui/page";
import { listNotifications } from "@/services/monitoring/alerts";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const unreadOnly = sp.unread === "1";
  const res = await listNotifications({ unreadOnly, page: Number(sp.page) || 1 });

  return (
    <div>
      <PageHeader
        title="Notifiche"
        sub={`${res.unread} non lette su ${res.total}`}
        actions={
          <Link
            href={unreadOnly ? "/notifications" : "/notifications?unread=1"}
            className="btn btn-ghost"
          >
            {unreadOnly ? "Mostra tutte" : "Solo non lette"}
          </Link>
        }
      />
      <TableWrap>
        <thead>
          <tr>
            <th>Gravità</th>
            <th>Titolo</th>
            <th>Tipo</th>
            <th>Quando</th>
            <th>Stato</th>
          </tr>
        </thead>
        <tbody>
          {res.data.length === 0 && <EmptyRow cols={5}>Nessuna notifica.</EmptyRow>}
          {res.data.map((n) => (
            <tr key={n.id} className={n.readAt ? "opacity-60" : ""}>
              <td>
                <Badge value={n.severity} />
              </td>
              <td className="text-sm">
                <div>{n.title}</div>
                {n.body && <div className="mt-0.5 text-xs text-[var(--ink-faint)]">{n.body}</div>}
              </td>
              <td className="mono text-xs text-[var(--ink-soft)]">{n.type}</td>
              <td className="text-xs text-[var(--ink-soft)]">
                {n.createdAt.toLocaleString("it-IT")}
              </td>
              <td className="text-xs">
                {n.readAt ? (
                  <span className="text-[var(--ink-faint)]">letta</span>
                ) : (
                  <span className="text-[var(--accent)]">nuova</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
