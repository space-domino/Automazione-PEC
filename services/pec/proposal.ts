import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { improveProposalCopy } from "@/services/ai-gateway";
import { writeAudit } from "@/services/state-machine";
import { htmlToText } from "./render";

/**
 * Rifinitura AI del corpo della bozza PEC (sezione 2 — unico impiego AI sul copy).
 * Opera solo su Communication in DRAFT. Preserva il link di disiscrizione.
 */

export interface Actor {
  userId?: string;
  requestId?: string;
}

export interface PolishOptions {
  tone?: string;
  instructions?: string;
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Se l'AI ha perso il link opt-out, lo riappende dal testo originale. */
function ensureOptOut(newHtml: string, originalHtml: string): string {
  if (newHtml.includes("/api/opt-out")) return newHtml;
  const m = originalHtml.match(/href="([^"]*\/api\/opt-out[^"]*)"/i);
  if (!m?.[1]) return newHtml;
  return `${newHtml}\n<hr>\n<p style="font-size:12px;color:#666">Per non ricevere ulteriori comunicazioni: <a href="${m[1]}">disiscrizione</a>.</p>`;
}

export async function polishPec(id: string, opts: PolishOptions, actor: Actor) {
  const comm = await db.communication.findUnique({
    where: { id },
    include: {
      company: { select: { legalName: true } },
      offer: {
        select: {
          landingPageUrl: true,
          price: true,
          currency: true,
          domain: { select: { fqdn: true } },
        },
      },
    },
  });
  if (!comm) throw new NotFoundError("Comunicazione inesistente");
  if (comm.status !== "DRAFT") {
    throw new ConflictError("BAD_STATE", "Il testo è rifinibile solo in bozza");
  }

  const out = await improveProposalCopy(
    {
      companyName: comm.company.legalName,
      domain: comm.offer?.domain.fqdn ?? "",
      price: comm.offer ? formatPrice(Number(comm.offer.price), comm.offer.currency) : "",
      offerUrl: comm.offer?.landingPageUrl ?? "",
      currentHtml: comm.bodyHtml,
      tone: opts.tone?.trim() || "professionale, sobrio, cordiale",
      instructions: opts.instructions?.trim() || null,
    },
    { companyId: comm.companyId },
  );

  const bodyHtml = ensureOptOut(out.bodyHtml, comm.bodyHtml);
  const updated = await db.communication.update({
    where: { id },
    data: { bodyHtml, bodyText: htmlToText(bodyHtml) },
  });

  await writeAudit(db, {
    action: "pec.draft.ai_polish",
    entityType: "Communication",
    entityId: id,
    actorType: "USER",
    actorUserId: actor.userId,
    requestId: actor.requestId,
    summary: `Testo PEC rifinito con AI: ${out.summary}`.slice(0, 300),
  });

  return updated;
}
