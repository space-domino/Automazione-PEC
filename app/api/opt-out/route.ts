import { db } from "@/lib/db";
import { verifyToken } from "@/lib/tokens";
import { writeAudit } from "@/services/state-machine";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Disiscrizione via link nella PEC (sezione G.13). Pubblica, senza login.
 * Token HMAC scope "optout" con `{ c: companyId }`. Idempotente.
 * GET perché il link è cliccato da un client di posta.
 */

function page(title: string, message: string, status: number): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<div style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a">
<h1 style="font-size:1.25rem">${title}</h1><p>${message}</p></div>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const res = verifyToken<{ c: string }>(token, "optout");
  if (!res.ok || !res.payload?.c) {
    return page("Link non valido", "Questo link di disiscrizione non è valido o è scaduto.", 400);
  }

  const companyId = res.payload.c;
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, legalName: true, pec: true },
  });
  if (!company) {
    return page("Azienda non trovata", "Non è stato possibile completare la richiesta.", 404);
  }

  await db.suppressionEntry.upsert({
    where: { type_value: { type: "COMPANY", value: companyId } },
    create: { type: "COMPANY", value: companyId, reason: "OPT_OUT", note: "opt-out via link PEC" },
    update: { reason: "OPT_OUT" },
  });
  if (company.pec) {
    await db.suppressionEntry.upsert({
      where: { type_value: { type: "PEC_ADDRESS", value: company.pec.toLowerCase() } },
      create: {
        type: "PEC_ADDRESS",
        value: company.pec.toLowerCase(),
        reason: "OPT_OUT",
        note: "opt-out via link PEC",
      },
      update: { reason: "OPT_OUT" },
    });
  }

  await writeAudit(db, {
    action: "suppression.opt_out",
    entityType: "Company",
    entityId: companyId,
    actorType: "SYSTEM",
    summary: `Opt-out registrato per ${company.legalName}`,
  });

  return page(
    "Disiscrizione registrata",
    "Non riceverai ulteriori comunicazioni commerciali da parte nostra. Puoi chiudere questa pagina.",
    200,
  );
}
