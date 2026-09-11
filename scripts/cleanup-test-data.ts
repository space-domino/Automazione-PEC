import "dotenv/config";
import { db } from "../lib/db";

/**
 * Ripulisce i dati di simulazione/test rimasti nel DB (creati il 2026-09-09
 * durante il collaudo della pipeline), mantenendo SOLO le aziende reali della
 * campagna "offerte" (creata l'11/09/2026) e i loro domini/offerte/PEC.
 *
 * Segnali usati per riconoscere i dati di test (nessuna azienda reale li ha):
 *  - "ALFA COSTRUZIONI S.R.L." possiede google.com, microsoft.com e un dominio
 *    .example (TLD riservato ai test) — inequivocabile.
 *  - 4 aziende create lo stesso giorno, zero domini/offerte/comunicazioni
 *    (Beta Servizi S.p.A., GAMMA DIGITAL SRL, Delta Impianti S.n.c. di Rossi,
 *    Società Agricola Eterna S.S.).
 *
 * eternaholding.it e absoluteplay.it restano (sono le offerte reali già
 * riassegnate alle aziende vere della campagna): qui si sistema solo il
 * companyId del Domain, rimasto sul vecchio record di test.
 */

const ALFA_ID = "cmttviaga0001ueycwaq7md05";
const EMPTY_TEST_COMPANY_NAMES = [
  "Beta Servizi S.p.A.",
  "GAMMA DIGITAL SRL",
  "Delta Impianti S.n.c. di Rossi",
  "Società Agricola Eterna S.S.",
];

const alfa = await db.company.findUnique({ where: { id: ALFA_ID }, include: { domains: true } });
if (!alfa) {
  console.log("ALFA COSTRUZIONI non trovata: probabilmente già ripulita.");
  process.exit(0);
}
console.log(`Trovata "${alfa.legalName}" con ${alfa.domains.length} domini.`);

// 1) sistema il companyId dei 2 domini riassegnati alla campagna reale
const eternaholding = await db.domain.findUnique({ where: { fqdn: "eternaholding.it" } });
const absoluteplay = await db.domain.findUnique({ where: { fqdn: "absoluteplay.it" } });
const realEterna = await db.company.findFirst({ where: { pec: "eternaholding@pec.it" } });
const realAbsolute = await db.company.findFirst({
  where: { pec: "absoluteplay@pec.alessandria.it" },
});

if (eternaholding && realEterna && eternaholding.companyId !== realEterna.id) {
  await db.domain.update({ where: { id: eternaholding.id }, data: { companyId: realEterna.id } });
  console.log(`eternaholding.it -> companyId corretto su ${realEterna.legalName}`);
}
if (absoluteplay && realAbsolute && absoluteplay.companyId !== realAbsolute.id) {
  await db.domain.update({ where: { id: absoluteplay.id }, data: { companyId: realAbsolute.id } });
  console.log(`absoluteplay.it -> companyId corretto su ${realAbsolute.legalName}`);
}

// 2) domini di puro test da eliminare (tutto ciò che è rimasto sotto Alfa Costruzioni)
const junkDomains = await db.domain.findMany({ where: { companyId: ALFA_ID } });
for (const d of junkDomains) {
  await db.availabilityCheck.deleteMany({ where: { domainId: d.id } });
  await db.aiUsage.deleteMany({ where: { domainId: d.id } });
  await db.order.deleteMany({ where: { domainId: d.id } });
  const offer = await db.offer.findUnique({ where: { domainId: d.id } });
  if (offer) {
    await db.landingPageView.deleteMany({ where: { offerId: offer.id } });
    await db.communication.deleteMany({ where: { offerId: offer.id } });
    await db.order.deleteMany({ where: { offerId: offer.id } });
    await db.offer.delete({ where: { id: offer.id } });
  }
  await db.domain.delete({ where: { id: d.id } });
  console.log(`eliminato dominio di test: ${d.fqdn}`);
}

// 3) comunicazioni di test rimaste intestate ad Alfa Costruzioni (bozze cancellate del collaudo)
const leftoverComms = await db.communication.deleteMany({ where: { companyId: ALFA_ID } });
console.log(`comunicazioni di test eliminate: ${leftoverComms.count}`);

await db.aiUsage.deleteMany({ where: { companyId: ALFA_ID } });
await db.importRow.deleteMany({ where: { companyId: ALFA_ID } });
await db.order.deleteMany({ where: { companyId: ALFA_ID } });
await db.company.delete({ where: { id: ALFA_ID } });
console.log(`eliminata azienda di test: ${alfa.legalName}`);

// 4) le 4 aziende di test vuote
for (const name of EMPTY_TEST_COMPANY_NAMES) {
  const c = await db.company.findFirst({ where: { legalName: name } });
  if (!c) continue;
  await db.importRow.deleteMany({ where: { companyId: c.id } });
  await db.aiUsage.deleteMany({ where: { companyId: c.id } });
  await db.company.delete({ where: { id: c.id } });
  console.log(`eliminata azienda di test vuota: ${name}`);
}

// 5) batch di import di collaudo, se rimasto orfano (senza più righe collegate)
const orphanBatches = await db.importBatch.findMany({
  where: { originalFilename: { contains: "aziende" } },
  include: { _count: { select: { rows: true, companies: true } } },
});
for (const b of orphanBatches) {
  if (b._count.companies === 0) {
    await db.importRow.deleteMany({ where: { batchId: b.id } });
    await db.importBatch.delete({ where: { id: b.id } });
    console.log(`eliminato import batch di collaudo: ${b.originalFilename} (${b.id})`);
  }
}

const total = await db.company.count();
console.log(`\nAziende rimaste nel DB: ${total} (dovrebbero essere le 99 reali della campagna).`);
process.exit(0);
