import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Template della mail "completa la registrazione" (canale EMAIL/SendGrid,
 * non PEC). Un solo template attivo per ora — a differenza del raccoglitore
 * PEC non serve scegliere tra varianti per l'invio automatico post-acquisto.
 */

export interface EmailTemplateView {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  updatedAt: Date;
}

export async function getAccountSetupTemplate(): Promise<EmailTemplateView | null> {
  const row = await db.messageTemplate.findFirst({
    where: { type: "EMAIL_BODY", name: "account-setup", isActive: true },
    orderBy: { version: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subject: row.subject ?? "",
    bodyHtml: row.bodyHtml,
    updatedAt: row.updatedAt,
  };
}

export async function saveAccountSetupTemplate(input: {
  bodyHtml: string;
  subject: string;
}): Promise<EmailTemplateView> {
  const existing = await db.messageTemplate.findFirst({
    where: { type: "EMAIL_BODY", name: "account-setup" },
  });
  const row = existing
    ? await db.messageTemplate.update({
        where: { id: existing.id },
        data: { bodyHtml: input.bodyHtml, subject: input.subject, isActive: true },
      })
    : await db.messageTemplate.create({
        data: {
          type: "EMAIL_BODY",
          name: "account-setup",
          version: 1,
          isActive: true,
          bodyHtml: input.bodyHtml,
          subject: input.subject,
          variables: [] as unknown as Prisma.InputJsonValue,
        },
      });
  return {
    id: row.id,
    name: row.name,
    subject: row.subject ?? "",
    bodyHtml: row.bodyHtml,
    updatedAt: row.updatedAt,
  };
}
