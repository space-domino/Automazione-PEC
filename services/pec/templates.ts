import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import type { Prisma } from "@prisma/client";

/**
 * Lettura/scrittura del template PEC attivo dalla console (M13).
 * Il body vive in un MessageTemplate PEC_BODY, l'oggetto in un PEC_SUBJECT.
 */

export interface PecTemplateView {
  bodyId: string;
  name: string;
  bodyHtml: string;
  subject: string;
  updatedAt: Date;
}

async function resolveBody() {
  const activeId = await getSetting("pec.active_template");
  const byId = activeId ? await db.messageTemplate.findUnique({ where: { id: activeId } }) : null;
  if (byId) return byId;
  return db.messageTemplate.findFirst({
    where: { type: "PEC_BODY", isActive: true },
    orderBy: { version: "desc" },
  });
}

function resolveSubject() {
  return db.messageTemplate.findFirst({
    where: { type: "PEC_SUBJECT", isActive: true },
    orderBy: { version: "desc" },
  });
}

export async function getActivePecTemplate(): Promise<PecTemplateView | null> {
  const body = await resolveBody();
  if (!body) return null;
  const subj = await resolveSubject();
  return {
    bodyId: body.id,
    name: body.name,
    bodyHtml: body.bodyHtml,
    subject: subj?.bodyHtml ?? "",
    updatedAt: body.updatedAt,
  };
}

export async function saveActivePecTemplate(
  input: { bodyHtml: string; subject?: string },
  actor: { userId?: string } = {},
): Promise<PecTemplateView | null> {
  const body = await resolveBody();
  let bodyId: string;

  if (body) {
    await db.messageTemplate.update({
      where: { id: body.id },
      data: { bodyHtml: input.bodyHtml },
    });
    bodyId = body.id;
  } else {
    const created = await db.messageTemplate.create({
      data: {
        type: "PEC_BODY",
        name: "console",
        version: 1,
        isActive: true,
        bodyHtml: input.bodyHtml,
        variables: [] as Prisma.InputJsonValue,
      },
    });
    bodyId = created.id;
    await setSetting("pec.active_template", bodyId);
  }

  if (input.subject !== undefined) {
    const subj = await resolveSubject();
    if (subj) {
      await db.messageTemplate.update({
        where: { id: subj.id },
        data: { bodyHtml: input.subject },
      });
    } else {
      await db.messageTemplate.create({
        data: {
          type: "PEC_SUBJECT",
          name: "console",
          version: 1,
          isActive: true,
          bodyHtml: input.subject,
          variables: [] as Prisma.InputJsonValue,
        },
      });
    }
  }

  await db.auditLog.create({
    data: {
      action: "pec.template.update",
      entityType: "MessageTemplate",
      entityId: bodyId,
      actorType: "USER",
      actorUserId: actor.userId ?? null,
      summary: "Template PEC aggiornato dalla console",
    },
  });

  return getActivePecTemplate();
}
