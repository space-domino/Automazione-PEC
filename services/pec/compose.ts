import { ConflictError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { signToken } from "@/lib/tokens";
import { domainStateConfig, transition, writeAudit } from "@/services/state-machine";
import type { Prisma } from "@prisma/client";
import { PecRecipientMissingError } from "./errors";
import { type TemplateVars, htmlToText, renderTemplate } from "./render";
import { assertNotSuppressed } from "./suppression";
import { pecFromAddress } from "./transport";

/**
 * Composizione della PEC in bozza (sezione H.6).
 * Deterministica: rende i MessageTemplate attivi con le variabili di offerta/azienda.
 * L'invio e l'approvazione sono M10.
 */

export interface Actor {
  userId?: string;
  requestId?: string;
}

export interface ComposeOptions {
  /** nome template PEC_BODY alternativo (default: quello attivo da Setting) */
  templateName?: string;
  /** override manuale del corpo HTML (es. testo rivisto a mano o da AI) */
  bodyHtmlOverride?: string;
  sellerLegalName?: string;
  sellerContact?: string;
}

interface RenderedPec {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  templateId: string | null;
  templateVersion: number | null;
  recipient: string;
  vars: TemplateVars;
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

async function loadOfferBundle(offerId: string) {
  const offer = await db.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    include: { company: true, domain: true },
  });
  if (!offer) throw new ValidationError(undefined, "Offerta inesistente");
  return offer;
}

async function resolveTemplates(name?: string) {
  const legacySubject = await db.messageTemplate.findFirst({
    where: { type: "PEC_SUBJECT", isActive: true },
    orderBy: { version: "desc" },
  });

  let body: Prisma.MessageTemplateGetPayload<true> | null = null;
  if (name) {
    body = await db.messageTemplate.findFirst({
      where: { type: "PEC_BODY", name },
      orderBy: { version: "desc" },
    });
  } else {
    const activeId = await getSetting("pec.active_template");
    if (activeId) body = await db.messageTemplate.findUnique({ where: { id: activeId } });
    if (!body) {
      body = await db.messageTemplate.findFirst({
        where: { type: "PEC_BODY", isActive: true },
        orderBy: { version: "desc" },
      });
    }
  }
  if (!body) throw new ValidationError(undefined, "Nessun template PEC_BODY disponibile");
  // L'oggetto vive nel body stesso (colonna `subject`); fallback alla vecchia riga PEC_SUBJECT.
  const subjectText =
    body.subject ?? legacySubject?.bodyHtml ?? "Disponibilità del dominio {{domain}}";
  return { subjectText, body };
}

async function renderFor(offerId: string, opts: ComposeOptions): Promise<RenderedPec> {
  const offer = await loadOfferBundle(offerId);
  const { company, domain } = offer;
  if (!company.pec) throw new PecRecipientMissingError();
  await assertNotSuppressed(company, domain.fqdn);

  const { subjectText, body: bodyTpl } = await resolveTemplates(opts.templateName);

  const sellerLegalName = opts.sellerLegalName ?? "Space Domino S.R.L.";
  const sellerContact = opts.sellerContact ?? pecFromAddress();
  const optoutToken = signToken("optout", { c: company.id }, { ttlSec: 400 * 86_400 });
  const optoutUrl = `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/opt-out?t=${optoutToken}`;

  const listAmount = Number(offer.price);
  const promo = Number(await getSetting("pec.promo_price")) || 0;
  const onPromo = promo > 0 && promo < listAmount;
  const effective = onPromo ? promo : listAmount;

  const vars: TemplateVars = {
    company_name: company.legalName,
    domain: domain.fqdn,
    price: formatPrice(effective, offer.currency),
    list_price: formatPrice(listAmount, offer.currency),
    discount_pct: onPromo ? String(Math.round((1 - effective / listAmount) * 100)) : "",
    offer_url: offer.landingPageUrl,
    seller_legal_name: sellerLegalName,
    seller_contact: sellerContact,
    optout_url: optoutUrl,
  };

  const subject = renderTemplate(subjectText, vars);
  const bodyHtml = opts.bodyHtmlOverride
    ? renderTemplate(opts.bodyHtmlOverride, vars)
    : renderTemplate(bodyTpl.bodyHtml, vars);
  const bodyText = bodyTpl.bodyText ? renderTemplate(bodyTpl.bodyText, vars) : htmlToText(bodyHtml);

  return {
    subject: subject.trim(),
    bodyHtml,
    bodyText,
    templateId: bodyTpl.id,
    templateVersion: bodyTpl.version,
    recipient: company.pec,
    vars,
  };
}

/** Anteprima senza persistere (per la UI). */
export async function previewPec(offerId: string, opts: ComposeOptions = {}) {
  const r = await renderFor(offerId, opts);
  return { subject: r.subject, bodyHtml: r.bodyHtml, bodyText: r.bodyText, recipient: r.recipient };
}

/**
 * Crea (o rigenera) la Communication PEC in bozza per un'offerta pubblicata.
 * Se esiste già una bozza per l'offerta, la aggiorna in place.
 */
export async function composePecDraft(offerId: string, opts: ComposeOptions, actor: Actor) {
  const offer = await loadOfferBundle(offerId);
  const rendered = await renderFor(offerId, opts);

  const existing = await db.communication.findFirst({
    where: { offerId, status: "DRAFT" },
  });

  if (existing) {
    const updated = await db.communication.update({
      where: { id: existing.id },
      data: {
        recipient: rendered.recipient,
        fromAddress: pecFromAddress(),
        subject: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        bodyText: rendered.bodyText,
        templateId: rendered.templateId,
        templateVersion: rendered.templateVersion,
      },
    });
    await writeAudit(db, {
      action: "pec.draft.recompose",
      entityType: "Communication",
      entityId: updated.id,
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      summary: `Bozza PEC rigenerata per ${offer.domain.fqdn}`,
    });
    return updated;
  }

  if (offer.domain.status !== "OFFER_PUBLISHED" && offer.domain.status !== "PEC_DRAFT") {
    throw new ConflictError(
      "BAD_STATE",
      `Bozza PEC creabile da OFFER_PUBLISHED (dominio in ${offer.domain.status})`,
    );
  }

  const created = await db.communication.create({
    data: {
      companyId: offer.companyId,
      offerId,
      channel: "PEC",
      recipient: rendered.recipient,
      fromAddress: pecFromAddress(),
      subject: rendered.subject,
      bodyHtml: rendered.bodyHtml,
      bodyText: rendered.bodyText,
      templateId: rendered.templateId,
      templateVersion: rendered.templateVersion,
      status: "DRAFT",
    },
  });

  if (offer.domain.status === "OFFER_PUBLISHED") {
    await transition(domainStateConfig, offer.domainId, "PEC_DRAFT", {
      actorType: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      reason: "bozza PEC creata",
    });
  }

  await writeAudit(db, {
    action: "pec.draft.create",
    entityType: "Communication",
    entityId: created.id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    after: { recipient: rendered.recipient, subject: rendered.subject },
    summary: `Bozza PEC creata per ${offer.domain.fqdn}`,
  });

  return created;
}
