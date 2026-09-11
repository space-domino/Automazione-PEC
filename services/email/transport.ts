import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Trasporto SendGrid (sezione "post-acquisto" — mail transazionali, canale
 * EMAIL, non PEC). API HTTP diretta (v3/mail/send): niente SDK, un fetch.
 *
 * Due modalità:
 *  - `templateId` + `dynamicTemplateData`: Dynamic Template SendGrid (vedi
 *    sendgrid-templates.ts) — oggetto e HTML vivono su SendGrid.
 *  - `subject` + `html`: contenuto inviato inline, per compatibilità/test.
 */

const log = logger.child({ svc: "email" });

export interface SendEmailInput {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, string>;
}

export interface SendEmailResult {
  messageId: string | null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!features.email) {
    throw new Error(
      "SendGrid non configurato (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL mancanti in .env)",
    );
  }
  if (!input.templateId && !input.html) {
    throw new Error("sendEmail: serve templateId oppure html");
  }

  const personalization: Record<string, unknown> = { to: [{ email: input.to }] };
  if (input.templateId) personalization.dynamic_template_data = input.dynamicTemplateData ?? {};

  const body: Record<string, unknown> = {
    personalizations: [personalization],
    from: { email: env.SENDGRID_FROM_EMAIL, name: "Space Domino" },
  };
  if (input.templateId) {
    body.template_id = input.templateId;
  } else {
    body.subject = input.subject;
    body.content = [
      ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
      { type: "text/html", value: input.html },
    ];
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const respBody = await res.text().catch(() => "");
    const msg = `SendGrid ${res.status}: ${respBody.slice(0, 500)}`;
    log.error({ to: input.to, status: res.status }, msg);
    throw new Error(msg);
  }

  const messageId = res.headers.get("x-message-id");
  log.info({ to: input.to, messageId, templateId: input.templateId }, "email inviata via SendGrid");
  return { messageId };
}
