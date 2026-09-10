import { PageHeader } from "@/components/ui/page";
import { getPecTemplate, listPecTemplates } from "@/services/pec/templates";
import Link from "next/link";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const templates = await listPecTemplates();
  const selectedId =
    sp.t && templates.some((t) => t.id === sp.t)
      ? sp.t
      : (templates.find((t) => t.isActive)?.id ?? templates[0]?.id);
  const current = selectedId ? await getPecTemplate(selectedId) : null;

  return (
    <div>
      <PageHeader
        title="Template PEC"
        sub="Raccoglitore dei modelli. Quello attivo è usato per comporre e inviare le PEC."
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <nav className="panel w-full shrink-0 overflow-hidden p-1 md:w-64">
          {templates.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--ink-faint)]">
              Nessun template. Creane uno.
            </p>
          )}
          {templates.map((t) => {
            const on = t.id === selectedId;
            return (
              <Link
                key={t.id}
                href={`/templates?t=${t.id}`}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${
                  on
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--ink)] hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className="truncate">{t.name}</span>
                {t.isActive && (
                  <span className="chip shrink-0 text-[10px] text-[var(--ok)]">attivo</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          {current ? (
            <TemplateEditor
              key={current.id}
              current={{
                id: current.id,
                name: current.name,
                bodyHtml: current.bodyHtml,
                subject: current.subject,
                isActive: current.isActive,
              }}
            />
          ) : (
            <TemplateEditor current={null} />
          )}
        </div>
      </div>
    </div>
  );
}
