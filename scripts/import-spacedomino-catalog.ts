import "dotenv/config";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { slugify } from "../lib/text";
import { normalizeCompany } from "../services/company-registry";

/**
 * Import una-tantum del catalogo `products` di spacedomino.it nella piattaforma.
 * NON tocca spacedomino: legge un export JSON della tabella `products`.
 *
 * Export (da eseguire sul VPS di spacedomino):
 *   docker exec spacedomino_db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B spacedomino \
 *     -e "SELECT JSON_ARRAYAGG(JSON_OBJECT(\"name\",name,\"tld\",tld,\"price\",price,\
 *         \"premium\",premium,\"category\",category,\"createdAt\",createdAt)) FROM products"' \
 *     > products-export.json
 *
 * Poi:  npm run import:spacedomino -- data/spacedomino-products.json
 *
 * Idempotente: chiave = fqdn. Ri-eseguibile senza doppioni.
 */

interface ProductRow {
  name: string; // SLD, es. "eternaholding"
  tld: string; // con o senza punto, es. ".it"
  price: number | string;
  premium?: boolean | number;
  category?: string;
  createdAt?: string;
}

const INPUT = process.argv[2] ?? "data/spacedomino-products.json";
const SELLER_BASE = (process.env.SPACEDOMINO_BASE_URL ?? "https://spacedomino.it").replace(
  /\/+$/,
  "",
);

const FORM_MAP: Record<string, string> = {
  srl: "S.r.l.",
  srls: "S.r.l.s.",
  spa: "S.p.A.",
  snc: "S.n.c.",
  sas: "S.a.s.",
  ss: "S.s.",
  coop: "Coop.",
};

/** "progresso-srl" -> "Progresso S.r.l."  ·  "ama-gorizia" -> "AMA Gorizia" */
function deSlug(name: string): string {
  const parts = name.split("-").filter(Boolean);
  return parts
    .map((p, i) => {
      const low = p.toLowerCase();
      if (FORM_MAP[low]) return FORM_MAP[low];
      if (i === 0 && /^[a-z]{2,3}$/.test(low)) return low.toUpperCase();
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(" ");
}

async function main() {
  const rows: ProductRow[] = JSON.parse(readFileSync(INPUT, "utf8"));
  console.log(`Import di ${rows.length} prodotti da ${INPUT}`);

  let newCompanies = 0;
  let newDomains = 0;
  let newOffers = 0;
  let skipped = 0;

  for (const r of rows) {
    const tld = r.tld.replace(/^\.+/, "").toLowerCase();
    const sld = r.name.trim().toLowerCase();
    if (!sld || !tld) {
      skipped++;
      continue;
    }
    const fqdn = `${sld}.${tld}`;
    const slug = slugify(fqdn);
    const price = Number(r.price);
    const createdAt = r.createdAt ? new Date(r.createdAt) : new Date();
    const category = r.category ?? "Domini Premium";
    const landingPageUrl = `${SELLER_BASE}/domini/${slug}`;

    const existing = await db.domain.findUnique({ where: { fqdn }, include: { offer: true } });
    if (existing) {
      // completa l'eventuale offerta mancante (run parziale precedente)
      if (!existing.offer && existing.status === "OFFER_PUBLISHED") {
        await db.offer.create({
          data: {
            companyId: existing.companyId,
            domainId: existing.id,
            slug,
            title: fqdn,
            price,
            currency: "EUR",
            landingPageUrl,
            status: "PUBLISHED",
            publishedAt: createdAt,
          },
        });
        newOffers++;
      }
      skipped++;
      continue;
    }

    const norm = normalizeCompany({ legalName: deSlug(sld) });
    let company = await db.company.findFirst({
      where: { dedupeHash: norm.dedupeHash, deletedAt: null },
    });
    if (!company) {
      company = await db.company.create({
        data: {
          legalName: norm.legalName,
          normalizedName: norm.normalizedName,
          province: norm.province,
          provinceName: norm.provinceName,
          rawData: { source: "spacedomino.products", productName: r.name, tld: r.tld, category },
          dedupeHash: norm.dedupeHash,
        },
      });
      newCompanies++;
    }

    const domain = await db.domain.create({
      data: {
        companyId: company.id,
        fqdn,
        sld,
        extension: tld,
        status: "OFFER_PUBLISHED",
        availabilityResult: "REGISTERED",
        availabilityCheckedAt: createdAt,
        availabilityProvider: "spacedomino-import",
        purchasedAt: createdAt,
        purchaseCurrency: "EUR",
        registrar: "Space Domino",
        purchaseNotes: `Importato da spacedomino.products — categoria "${category}"`,
        sellingPrice: price,
      },
    });
    newDomains++;

    await db.stateTransition.create({
      data: {
        entityType: "Domain",
        entityId: domain.id,
        fromStatus: null,
        toStatus: "OFFER_PUBLISHED",
        actorType: "SYSTEM",
        reason: "import spacedomino catalog",
      },
    });

    await db.offer.create({
      data: {
        companyId: company.id,
        domainId: domain.id,
        slug,
        title: fqdn,
        price,
        currency: "EUR",
        landingPageUrl,
        status: "PUBLISHED",
        publishedAt: createdAt,
      },
    });
    newOffers++;
  }

  console.log(
    `Fatto. Aziende nuove: ${newCompanies} · Domini: ${newDomains} · Offerte: ${newOffers} · saltati (già presenti): ${skipped}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
