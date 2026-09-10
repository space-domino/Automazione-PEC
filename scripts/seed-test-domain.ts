import "dotenv/config";
import { db } from "../lib/db";
import { normalizeCompany } from "../services/company-registry/normalize";

/**
 * Prepara un dominio "pronto all'acquisto" per il test manuale dell'automazione PEC.
 * Salta l'import CSV e la discovery: crea Company (con PEC destinatario) + Domain AVAILABLE.
 *
 *   npx tsx scripts/seed-test-domain.ts [fqdn]
 */

const PEC = "arturotucci@pec.dgtinnovation.it";
const fqdn = (process.argv[2] ?? `dgt-innovation-test-${Date.now().toString(36)}.it`)
  .trim()
  .toLowerCase();
const [sld, ...rest] = fqdn.split(".");
const extension = rest.join(".");
if (!sld || !extension) {
  console.error(`FQDN non valido: ${fqdn}`);
  process.exit(1);
}

const n = normalizeCompany({
  legalName: "DGT Innovation Test SRL",
  vatNumber: null,
  pec: PEC,
  province: "RM",
  website: null,
  sector: "sviluppo software",
});

const company = await db.company.upsert({
  where: { dedupeHash: n.dedupeHash },
  update: { pec: n.pec },
  create: {
    legalName: n.legalName,
    normalizedName: n.normalizedName,
    province: n.province,
    provinceName: n.provinceName,
    pec: n.pec,
    vatNumber: n.vatNumber,
    website: n.website,
    sector: n.sector,
    rawData: { source: "seed-test-domain" },
    dedupeHash: n.dedupeHash,
  },
});

const domain = await db.domain.upsert({
  where: { fqdn },
  update: {
    companyId: company.id,
    status: "AVAILABLE",
    availabilityResult: "AVAILABLE",
    availabilityCheckedAt: new Date(),
    availabilityProvider: "seed",
  },
  create: {
    companyId: company.id,
    fqdn,
    sld,
    extension,
    status: "AVAILABLE",
    availabilityResult: "AVAILABLE",
    availabilityCheckedAt: new Date(),
    availabilityProvider: "seed",
    aiScore: 80,
    aiConfidence: 80,
    aiReasoning: "seed di test (nessuna generazione AI)",
    rankScore: 80,
    sellingPrice: 499,
  },
});

console.log(
  JSON.stringify(
    {
      companyId: company.id,
      companyPec: company.pec,
      domainId: domain.id,
      fqdn,
      openInConsole: `http://localhost:3000/domains/${domain.id}`,
    },
    null,
    2,
  ),
);
process.exit(0);
