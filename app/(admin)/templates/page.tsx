import { PageHeader } from "@/components/ui/page";
import { getActivePecTemplate } from "@/services/pec/templates";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const t = await getActivePecTemplate();

  return (
    <div>
      <PageHeader
        title="Template PEC"
        sub={
          t
            ? `${t.name} · ultimo salvataggio ${t.updatedAt.toLocaleString("it-IT")}`
            : "nessun template attivo — verrà creato al primo salvataggio"
        }
      />
      <TemplateEditor initial={{ bodyHtml: t?.bodyHtml ?? "", subject: t?.subject ?? "" }} />
    </div>
  );
}
