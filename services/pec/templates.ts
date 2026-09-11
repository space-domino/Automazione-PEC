import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import type { Prisma } from "@prisma/client";

/**
 * Raccoglitore dei template PEC (M13).
 * Ogni voce è un MessageTemplate PEC_BODY con nome, corpo HTML e oggetto propri
 * (colonna `subject`). `pec.active_template` punta a quello usato per compose/invio;
 * `isActive` viene tenuto allineato per i fallback legacy.
 */

export interface PecTemplateListItem {
  id: string;
  name: string;
  subject: string;
  isActive: boolean;
  updatedAt: Date;
}

export interface PecTemplateView {
  /** compat: id del body */
  bodyId: string;
  id: string;
  name: string;
  bodyHtml: string;
  subject: string;
  isActive: boolean;
  updatedAt: Date;
}

const EMPTY_VARS = [] as unknown as Prisma.InputJsonValue;

/** Oggetto legacy (riga PEC_SUBJECT unica) — fallback se un body non ha `subject`. */
async function legacySubject(): Promise<string> {
  const row = await db.messageTemplate.findFirst({
    where: { type: "PEC_SUBJECT", isActive: true },
    orderBy: { version: "desc" },
  });
  return row?.bodyHtml ?? "";
}

async function resolveActiveBody() {
  const activeId = await getSetting("pec.active_template");
  const byId = activeId ? await db.messageTemplate.findUnique({ where: { id: activeId } }) : null;
  if (byId && byId.type === "PEC_BODY") return byId;
  return db.messageTemplate.findFirst({
    where: { type: "PEC_BODY", isActive: true },
    orderBy: { version: "desc" },
  });
}

function toView(
  body: Prisma.MessageTemplateGetPayload<true>,
  fallbackSubject: string,
  activeId: string | null,
): PecTemplateView {
  return {
    bodyId: body.id,
    id: body.id,
    name: body.name,
    bodyHtml: body.bodyHtml,
    subject: body.subject ?? fallbackSubject,
    isActive: activeId ? body.id === activeId : body.isActive,
    updatedAt: body.updatedAt,
  };
}

/** Elenco del raccoglitore. */
export async function listPecTemplates(): Promise<PecTemplateListItem[]> {
  // in sequenza, non Promise.all: vedi services/catalog/companies.ts per il perché.
  const rows = await db.messageTemplate.findMany({
    where: { type: "PEC_BODY" },
    orderBy: { createdAt: "asc" },
  });
  const activeId = await getSetting("pec.active_template");
  const fallback = await legacySubject();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    subject: r.subject ?? fallback,
    isActive: activeId ? r.id === activeId : r.isActive,
    updatedAt: r.updatedAt,
  }));
}

/** Un template del raccoglitore (default: quello attivo). */
export async function getPecTemplate(id?: string): Promise<PecTemplateView | null> {
  const body = id
    ? await db.messageTemplate.findUnique({ where: { id } })
    : await resolveActiveBody();
  if (!body || body.type !== "PEC_BODY") return null;
  const activeId = (await getSetting("pec.active_template")) || null;
  return toView(body, await legacySubject(), activeId);
}

/** compat con la vecchia API a template unico. */
export async function getActivePecTemplate(): Promise<PecTemplateView | null> {
  return getPecTemplate();
}

async function nextFreeName(base: string): Promise<string> {
  const taken = new Set(
    (
      await db.messageTemplate.findMany({ where: { type: "PEC_BODY" }, select: { name: true } })
    ).map((r) => r.name),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

export async function createPecTemplate(
  input: { name: string; bodyHtml: string; subject: string },
  actor: { userId?: string } = {},
): Promise<PecTemplateView> {
  const name = input.name.trim();
  if (!name) throw new ValidationError(undefined, "Nome template obbligatorio");
  if (await db.messageTemplate.findFirst({ where: { type: "PEC_BODY", name } })) {
    throw new ConflictError("NAME_TAKEN", `Esiste già un template "${name}"`);
  }
  const created = await db.messageTemplate.create({
    data: {
      type: "PEC_BODY",
      name,
      version: 1,
      isActive: false,
      bodyHtml: input.bodyHtml,
      subject: input.subject,
      variables: EMPTY_VARS,
      createdByUserId: actor.userId ?? null,
    },
  });
  await db.auditLog.create({
    data: {
      action: "pec.template.create",
      entityType: "MessageTemplate",
      entityId: created.id,
      actorType: "USER",
      actorUserId: actor.userId ?? null,
      summary: `Template PEC "${name}" creato`,
    },
  });
  return toView(created, "", (await getSetting("pec.active_template")) || null);
}

export async function updatePecTemplate(
  id: string,
  input: { name?: string; bodyHtml?: string; subject?: string },
  actor: { userId?: string } = {},
): Promise<PecTemplateView> {
  const body = await db.messageTemplate.findUnique({ where: { id } });
  if (!body || body.type !== "PEC_BODY") throw new NotFoundError("Template non trovato");

  const data: Prisma.MessageTemplateUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ValidationError(undefined, "Nome non valido");
    if (name !== body.name) {
      const clash = await db.messageTemplate.findFirst({
        where: { type: "PEC_BODY", name, id: { not: id } },
      });
      if (clash) throw new ConflictError("NAME_TAKEN", `Esiste già un template "${name}"`);
      data.name = name;
    }
  }
  if (input.bodyHtml !== undefined) data.bodyHtml = input.bodyHtml;
  if (input.subject !== undefined) data.subject = input.subject;

  const updated = await db.messageTemplate.update({ where: { id }, data });
  await db.auditLog.create({
    data: {
      action: "pec.template.update",
      entityType: "MessageTemplate",
      entityId: id,
      actorType: "USER",
      actorUserId: actor.userId ?? null,
      summary: `Template PEC "${updated.name}" aggiornato`,
    },
  });
  return toView(updated, await legacySubject(), (await getSetting("pec.active_template")) || null);
}

/** compat: aggiorna il template attualmente attivo. */
export async function saveActivePecTemplate(
  input: { bodyHtml: string; subject?: string },
  actor: { userId?: string } = {},
): Promise<PecTemplateView | null> {
  const active = await resolveActiveBody();
  if (!active) {
    const created = await createPecTemplate(
      {
        name: await nextFreeName("console"),
        bodyHtml: input.bodyHtml,
        subject: input.subject ?? "",
      },
      actor,
    );
    await activatePecTemplate(created.id, actor);
    return getPecTemplate(created.id);
  }
  return updatePecTemplate(active.id, { bodyHtml: input.bodyHtml, subject: input.subject }, actor);
}

export async function activatePecTemplate(
  id: string,
  actor: { userId?: string } = {},
): Promise<PecTemplateView> {
  const body = await db.messageTemplate.findUnique({ where: { id } });
  if (!body || body.type !== "PEC_BODY") throw new NotFoundError("Template non trovato");

  await db.$transaction([
    db.messageTemplate.updateMany({
      where: { type: "PEC_BODY", isActive: true, id: { not: id } },
      data: { isActive: false },
    }),
    db.messageTemplate.update({ where: { id }, data: { isActive: true } }),
  ]);
  await setSetting("pec.active_template", id);
  await db.auditLog.create({
    data: {
      action: "pec.template.activate",
      entityType: "MessageTemplate",
      entityId: id,
      actorType: "USER",
      actorUserId: actor.userId ?? null,
      summary: `Template PEC "${body.name}" attivato`,
    },
  });
  return toView({ ...body, isActive: true }, await legacySubject(), id);
}

export async function deletePecTemplate(
  id: string,
  actor: { userId?: string } = {},
): Promise<void> {
  const body = await db.messageTemplate.findUnique({
    where: { id },
    include: { _count: { select: { offers: true, communications: true } } },
  });
  if (!body || body.type !== "PEC_BODY") throw new NotFoundError("Template non trovato");

  const activeId = await getSetting("pec.active_template");
  if (id === activeId || body.isActive) {
    throw new ConflictError("TEMPLATE_ACTIVE", "Non puoi eliminare il template attivo");
  }
  if (body._count.offers > 0 || body._count.communications > 0) {
    throw new ConflictError(
      "TEMPLATE_IN_USE",
      "Template collegato a offerte o PEC già create: non eliminabile",
    );
  }
  await db.messageTemplate.delete({ where: { id } });
  await db.auditLog.create({
    data: {
      action: "pec.template.delete",
      entityType: "MessageTemplate",
      entityId: id,
      actorType: "USER",
      actorUserId: actor.userId ?? null,
      summary: `Template PEC "${body.name}" eliminato`,
    },
  });
}
