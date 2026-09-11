import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Trasporto SendGrid (sezione "post-acquisto" — mail transazionali, canale
 * EMAIL, non PEC). API HTTP diretta (v3/mail/send): niente SDK, un fetch.
 */

const log = logger.child({ svc: "email" });

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
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

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: env.SENDGRID_FROM_EMAIL, name: "Space Domino" },
      subject: input.subject,
      content: [
        ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
        { type: "text/html", value: input.html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = `SendGrid ${res.status}: ${body.slice(0, 500)}`;
    log.error({ to: input.to, status: res.status }, msg);
    throw new Error(msg);
  }

  const messageId = res.headers.get("x-message-id");
  log.info({ to: input.to, messageId }, "email inviata via SendGrid");
  return { messageId };
}
