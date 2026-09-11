import { env, features } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/settings";
import { htmlToText } from "@/services/pec/render";

/**
 * Sincronizza un template verso i Dynamic Template di SendGrid (Template
 * Engine — Handlebars, stessa sintassi `{{var}}` del nostro renderer, quindi
 * l'HTML si carica cosí com'è). L'id del template creato si salva in Setting
 * (`email.account_setup_sendgrid_template_id`): le sincronizzazioni
 * successive aggiungono una nuova versione allo STESSO template invece di
 * crearne uno nuovo ogni volta.
 */

const SG_BASE = "https://api.sendgrid.com/v3";

async function sg<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY non impostata");
  const res = await fetch(`${SG_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SendGrid ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 500)}`,
    );
  }
  return res.json() as Promise<T>;
}

export interface SyncTemplateInput {
  /** nome del contenitore template su SendGrid (creato una sola volta) */
  name: string;
  subject: string;
  html: string;
}

export interface SyncTemplateResult {
  templateId: string;
  versionId: string;
}

export async function syncAccountSetupTemplateToSendGrid(
  input: SyncTemplateInput,
): Promise<SyncTemplateResult> {
  if (!features.email) {
    throw new Error("SendGrid non configurato (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL mancanti)");
  }

  let templateId = await getSetting("email.account_setup_sendgrid_template_id");
  if (!templateId) {
    const created = await sg<{ id: string }>("/templates", {
      method: "POST",
      body: JSON.stringify({ name: input.name, generation: "dynamic" }),
    });
    templateId = created.id;
    await setSetting("email.account_setup_sendgrid_template_id", templateId);
  }

  const version = await sg<{ id: string; template_id: string }>(
    `/templates/${templateId}/versions`,
    {
      method: "POST",
      body: JSON.stringify({
        template_id: templateId,
        name: `${input.name} — ${new Date().toISOString()}`,
        subject: input.subject,
        html_content: input.html,
        plain_content: htmlToText(input.html),
        active: 1,
      }),
    },
  );

  return { templateId, versionId: version.id };
}
