import "dotenv/config";
import { env } from "../lib/env";
import { db } from "../lib/db";
import { renderTemplate } from "../services/pec/render";
import { sendApprovedPec } from "../services/pec/send";
import { signToken } from "../lib/tokens";

/**
 * Corregge e reinvia la PEC di ABSOLUTE PLAY S.R.L.: la campagna aveva riusato
 * un'offerta preesistente su absoluteplay.it (dati di test di una company
 * "ALFA COSTRUZIONI S.R.L." con anche google.com/microsoft.com a listino —
 * segnale inequivocabile di dato di test), componendo la PEC col destinatario
 * sbagliato. Qui si riassegna Communication+Offer all'azienda vera e si
 * reinvia col contenuto corretto.
 *
 *   npx tsx scripts/campaign-fix-absoluteplay.ts
 */

const badComm = await db.communication.findFirst({
  where: { subject: { contains: "absoluteplay.it" } },
  include: { offer: { include: { domain: true } } },
});
if (!badComm || !badComm.offer) throw new Error("comunicazione absoluteplay.it non trovata");

const realCompany = await db.company.findFirst({
  where: { pec: "absoluteplay@pec.alessandria.it" },
});
if (!realCompany) throw new Error("azienda ABSOLUTE PLAY S.R.L. non trovata nel DB");

const wrongCompany = await db.company.findUnique({ where: { id: badComm.offer.companyId } });
console.log(`destinatario sbagliato finora: ${wrongCompany?.legalName} <${badComm.recipient}>`);
console.log(`azienda corretta: ${realCompany.legalName} <${realCompany.pec}>`);

const tpl = await db.messageTemplate.findFirst({ where: { type: "PEC_BODY", name: "offerte" } });
if (!tpl) throw new Error('template "offerte" non trovato');

// riassegna l'offerta esistente all'azienda giusta (il dominio resta lo stesso)
await db.offer.update({ where: { id: badComm.offer.id }, data: { companyId: realCompany.id } });

const optoutToken = signToken("optout", { c: realCompany.id }, { ttlSec: 400 * 86_400 });
const vars = {
  company_name: realCompany.legalName,
  domain: badComm.offer.domain.fqdn,
  price: "49,99 €",
  list_price: "499,00 €",
  discount_pct: "90",
  offer_url: badComm.offer.landingPageUrl,
  seller_legal_name: "Space Domino S.R.L.",
  seller_contact: "dominoimprese@pec.net",
  optout_url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/opt-out?t=${optoutToken}`,
};

await db.communication.update({
  where: { id: badComm.id },
  data: {
    companyId: realCompany.id,
    recipient: realCompany.pec as string,
    subject: renderTemplate(tpl.subject ?? "", vars),
    bodyHtml: renderTemplate(tpl.bodyHtml, vars),
    bodyText: null,
    status: "APPROVED",
    lastError: null,
    providerMessageId: null,
    sentAt: null,
  },
});
console.log("comunicazione corretta -> APPROVED, invio in corso...");

const res = await sendApprovedPec(badComm.id, { requestId: "campaign-fix-absoluteplay" });
console.log("RISULTATO:", JSON.stringify(res, null, 2));
process.exit(0);
