import "dotenv/config";
import { env } from "../lib/env";
import { db } from "../lib/db";
import { renderTemplate } from "../services/pec/render";
import { sendApprovedPec } from "../services/pec/send";
import { signToken } from "../lib/tokens";

/**
 * Come campaign-fix-absoluteplay.ts: eternaholding.it era già un'offerta nel DB
 * (dati di test della company "ALFA COSTRUZIONI S.R.L." — stesso batch che
 * possiede anche google.com/microsoft.com/*.example, quindi sicuramente test,
 * non un affare reale). Riassegna l'offerta alla vera ETERNA HOLDING SRL,
 * crea la Communication corretta e la invia.
 *
 *   npx tsx scripts/campaign-fix-eternaholding.ts
 */

const domain = await db.domain.findUnique({ where: { fqdn: "eternaholding.it" } });
if (!domain) throw new Error("dominio eternaholding.it non trovato");
const offer = await db.offer.findFirst({ where: { domainId: domain.id, deletedAt: null } });
if (!offer) throw new Error("offerta per eternaholding.it non trovata");

const realCompany = await db.company.findFirst({ where: { pec: "eternaholding@pec.it" } });
if (!realCompany) throw new Error("azienda ETERNA HOLDING SRL non trovata nel DB (dovrebbe esistere dalla campagna)");

const wrongCompany = await db.company.findUnique({ where: { id: offer.companyId } });
console.log(`offerta finora intestata a: ${wrongCompany?.legalName}`);
console.log(`azienda corretta: ${realCompany.legalName} <${realCompany.pec}>`);
console.log(`stato dominio (lasciato invariato): ${domain.status}`);

await db.offer.update({ where: { id: offer.id }, data: { companyId: realCompany.id } });

const tpl = await db.messageTemplate.findFirst({ where: { type: "PEC_BODY", name: "offerte" } });
if (!tpl) throw new Error('template "offerte" non trovato');

const optoutToken = signToken("optout", { c: realCompany.id }, { ttlSec: 400 * 86_400 });
const vars = {
  company_name: realCompany.legalName,
  domain: domain.fqdn,
  price: "49,99 €",
  list_price: "499,00 €",
  discount_pct: "90",
  offer_url: offer.landingPageUrl,
  seller_legal_name: "Space Domino S.R.L.",
  seller_contact: "dominoimprese@pec.net",
  optout_url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/opt-out?t=${optoutToken}`,
};

const created = await db.communication.create({
  data: {
    companyId: realCompany.id,
    offerId: offer.id,
    channel: "PEC",
    recipient: realCompany.pec as string,
    fromAddress: "dominoimprese@pec.net",
    subject: renderTemplate(tpl.subject ?? "", vars),
    bodyHtml: renderTemplate(tpl.bodyHtml, vars),
    templateId: tpl.id,
    templateVersion: tpl.version,
    status: "APPROVED",
  },
});
console.log("comunicazione creata:", created.id, "-> invio in corso...");

const res = await sendApprovedPec(created.id, { requestId: "campaign-fix-eternaholding" });
console.log("RISULTATO:", JSON.stringify(res, null, 2));
process.exit(0);
