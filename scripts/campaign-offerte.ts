import "dotenv/config";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../lib/env";
import { slugify, stripAccents } from "../lib/text";
import { normalizeCompany } from "../services/company-registry/normalize";
import { renderTemplate } from "../services/pec/render";

/**
 * Campagna PEC "offerte": abbina ogni azienda della lista a un dominio già a
 * catalogo su spacedomino, poi (solo con --send) crea i record, compone la PEC
 * personalizzata col template "offerte" e ne accoda l'invio.
 *
 *   npx tsx scripts/campaign-offerte.ts                       # DRY-RUN: scrive abbinamenti + anteprime
 *   npx tsx scripts/campaign-offerte.ts --companies <file>    # lista aziende (TSV: ragione sociale \t provincia \t pec)
 *   npx tsx scripts/campaign-offerte.ts --send <abbinamenti.csv>   # ESEGUE (crea record + compone + accoda invio)
 *
 * Richiede il tunnel verso il MySQL di spacedomino (SPACEDOMINO_DATABASE_URL).
 */

const OUT_DIR = join(process.cwd(), "scripts", "campaign-out");
const args = process.argv.slice(2);
const getArg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const companiesFile =
  getArg("--companies") ?? "C:/Users/Administrator/Downloads/pasted_content_2.txt";
const sendCsv = getArg("--send");

// ---------- utils ----------
const compact = (s: string) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}
function score(cKey: string, pKey: string): number {
  if (!cKey || !pKey) return 0;
  if (cKey === pKey) return 1;
  if ((cKey.includes(pKey) || pKey.includes(cKey)) && Math.min(cKey.length, pKey.length) >= 4) {
    return 0.9 + 0.09 * (Math.min(cKey.length, pKey.length) / Math.max(cKey.length, pKey.length));
  }
  return dice(cKey, pKey);
}
function bucket(s: number): "alta" | "media" | "bassa" | "nessuno" {
  if (s >= 0.92) return "alta";
  if (s >= 0.75) return "media";
  if (s >= 0.6) return "bassa";
  return "nessuno";
}

// ---------- input ----------
interface Company {
  legalName: string;
  province: string;
  pec: string;
  key: string;
}
function parseCompanies(path: string): { rows: Company[]; noPec: string[] } {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: Company[] = [];
  const noPec: string[] = [];
  for (const line of lines) {
    const parts = line.split("\t").map((c) => c.trim());
    if (parts.length < 3) continue;
    const legalName = parts[0] ?? "";
    const province = parts[1] ?? "";
    const pec = parts[2] ?? "";
    if (!legalName || /ragione sociale/i.test(legalName)) continue; // header
    if (!pec || pec === "—" || !pec.includes("@")) {
      noPec.push(legalName);
      continue;
    }
    const norm = normalizeCompany({ legalName });
    rows.push({ legalName, province, pec, key: compact(norm.normalizedName || legalName) });
  }
  return { rows, noPec };
}

interface Product {
  id: number;
  name: string;
  tld: string;
  price: number;
  key: string;
}
/**
 * Prezzi di LISTINO: la promo di sito ha portato tutto il catalogo a 49,99, quindi
 * il valore "prima" va letto dal backup più recente di storefront-sale.
 */
function listinoMap(): Map<number, number> {
  const dir = join(process.cwd(), "scripts", "sale-backups");
  const m = new Map<number, number>();
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("prices-") && f.endsWith(".json"))
      .sort();
    const last = files.at(-1);
    if (!last) return m;
    const data = JSON.parse(readFileSync(join(dir, last), "utf8")) as {
      prices: { id: number; price: string | number }[];
    };
    for (const p of data.prices) m.set(Number(p.id), Number(p.price));
    console.log(`listino da backup ${last} (${m.size} prezzi)`);
  } catch {
    console.log("nessun backup listino: uso i prezzi correnti del catalogo");
  }
  return m;
}

async function loadCatalog(): Promise<Product[]> {
  const listino = listinoMap();
  const { createPool } = await import("mysql2/promise");
  const pool = createPool({ uri: env.SPACEDOMINO_DATABASE_URL as string, connectionLimit: 2 });
  try {
    const [rows] = await pool.query("SELECT id, name, tld, price FROM products");
    return (rows as Record<string, unknown>[]).map((r) => {
      const id = Number(r.id);
      return {
        id,
        name: String(r.name),
        tld: String(r.tld).replace(/^\.?/, "."),
        price: listino.get(id) ?? Number(r.price),
        key: compact(String(r.name)),
      };
    });
  } finally {
    await pool.end();
  }
}

interface Match {
  company: Company;
  product: Product | null;
  score: number;
  conf: ReturnType<typeof bucket>;
}
function matchAll(companies: Company[], catalog: Product[]): Match[] {
  const used = new Set<number>();
  const out: Match[] = [];
  // ordina per miglior punteggio così i match sicuri prendono il dominio per primi
  const scored = companies.map((c) => {
    let best: Product | null = null;
    let bestScore = 0;
    for (const p of catalog) {
      const s = score(c.key, p.key);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    return { c, best, bestScore };
  });
  scored.sort((a, b) => b.bestScore - a.bestScore);
  for (const { c } of scored) {
    let best: Product | null = null;
    let bestScore = 0;
    for (const p of catalog) {
      if (used.has(p.id)) continue;
      const s = score(c.key, p.key);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    const conf = bucket(bestScore);
    if (best && conf !== "nessuno") used.add(best.id);
    out.push({ company: c, product: conf === "nessuno" ? null : best, score: bestScore, conf });
  }
  // riporta nell'ordine della lista originale
  const idx = new Map(companies.map((c, i) => [c.legalName, i]));
  out.sort((a, b) => (idx.get(a.company.legalName) ?? 0) - (idx.get(b.company.legalName) ?? 0));
  return out;
}

// ---------- dry-run ----------
const CSV_HEADER =
  "riga;ragione_sociale;provincia;pec;dominio;tld;prezzo_listino;confidenza;punteggio";

function toCsv(matches: Match[]): string {
  const lines = [CSV_HEADER];
  matches.forEach((m, i) => {
    lines.push(
      [
        i + 1,
        m.company.legalName.replace(/;/g, ","),
        m.company.province,
        m.company.pec,
        m.product?.name ?? "",
        m.product?.tld ?? "",
        m.product ? m.product.price.toFixed(2) : "",
        m.conf,
        m.score.toFixed(3),
      ].join(";"),
    );
  });
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

async function previewVars(m: Match) {
  const p = m.product;
  if (!p) return null;
  const fqdn = `${p.name}${p.tld}`;
  const promo = 49.99;
  const listAmount = p.price;
  const onPromo = promo > 0 && promo < listAmount;
  return {
    company_name: m.company.legalName,
    domain: fqdn,
    price: eur(onPromo ? promo : listAmount),
    list_price: eur(listAmount),
    discount_pct: onPromo ? String(Math.round((1 - promo / listAmount) * 100)) : "",
    offer_url: `${env.SPACEDOMINO_BASE_URL.replace(/\/+$/, "")}/domini/${slugify(fqdn)}`,
    seller_legal_name: "Space Domino S.R.L.",
    seller_contact: "dominoimprese@pec.net",
    optout_url: `${env.SPACEDOMINO_BASE_URL}/api/opt-out?t=ESEMPIO`,
  };
}

async function dryRun() {
  const { rows, noPec } = parseCompanies(companiesFile);
  console.log(`aziende con PEC: ${rows.length} · senza PEC (saltate): ${noPec.length}`);
  const catalog = await loadCatalog();
  console.log(`domini a catalogo: ${catalog.length}`);

  const matches = matchAll(rows, catalog);
  const by = { alta: 0, media: 0, bassa: 0, nessuno: 0 };
  for (const m of matches) by[m.conf]++;
  console.log(
    `match  alta:${by.alta}  media:${by.media}  bassa:${by.bassa}  NESSUNO:${by.nessuno}`,
  );

  mkdirSync(join(OUT_DIR, "preview"), { recursive: true });
  writeFileSync(join(OUT_DIR, "abbinamenti.csv"), toCsv(matches));
  console.log(`\n-> ${join(OUT_DIR, "abbinamenti.csv")}`);

  const { db } = await import("../lib/db");
  const tpl = await db.messageTemplate.findFirst({
    where: { type: "PEC_BODY", name: "offerte" },
  });
  if (!tpl) {
    console.log('ATTENZIONE: template "offerte" non trovato, salto le anteprime.');
  } else {
    const sample = [
      ...matches.filter((m) => m.conf === "alta").slice(0, 4),
      ...matches.filter((m) => m.conf === "media" || m.conf === "bassa").slice(0, 4),
    ];
    for (const [i, m] of sample.entries()) {
      const v = await previewVars(m);
      if (!v) continue;
      const html = renderTemplate(tpl.bodyHtml, v);
      const subj = renderTemplate(tpl.subject ?? "", v);
      writeFileSync(
        join(OUT_DIR, "preview", `${String(i + 1).padStart(2, "0")}-${m.product?.name}.html`),
        `<!-- A: ${m.company.legalName}\n     PEC: ${m.company.pec}\n     OGGETTO: ${subj}\n     match: ${m.conf} (${m.score.toFixed(3)}) -->\n${html}`,
      );
    }
    console.log(`-> ${join(OUT_DIR, "preview")}  (${sample.length} anteprime)`);
  }

  const senza = matches.filter((m) => m.conf === "nessuno");
  if (senza.length) {
    console.log(`\nSENZA MATCH (${senza.length}) — da sistemare a mano nel CSV:`);
    for (const m of senza) console.log(`  - ${m.company.legalName}`);
  }
  console.log(
    "\nControlla e correggi abbinamenti.csv, poi:\n  npx tsx scripts/campaign-offerte.ts --send scripts/campaign-out/abbinamenti.csv",
  );
  process.exit(0);
}

// ---------- send ----------
async function send(csvPath: string) {
  const { db } = await import("../lib/db");
  const { features } = await import("../lib/env");
  if (!features.pec) {
    console.error("features.pec = false (SMTP non configurato). Interrompo.");
    process.exit(1);
  }
  const { transition, domainStateConfig } = await import("../services/state-machine");
  const { createOffer } = await import("../services/offers");
  const { markAsPurchased } = await import("../services/purchase");
  const { composePecDraft } = await import("../services/pec/compose");
  const { approvePec, queuePecSend } = await import("../services/pec/send");

  const text = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const [header, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
  if (!header) {
    console.error("CSV vuoto.");
    process.exit(1);
  }
  const cols = header.split(";").map((c) => c.trim());
  const ci = (n: string) => cols.indexOf(n);

  const actor = { requestId: "campaign-offerte" };
  const log: string[] = ["riga;ragione_sociale;dominio;esito;dettaglio"];
  let ok = 0;
  let skip = 0;
  let err = 0;

  for (const [n, line] of lines.entries()) {
    const c = line.split(";").map((x) => x.trim());
    const legalName = c[ci("ragione_sociale")];
    const pec = c[ci("pec")];
    const name = c[ci("dominio")];
    const tld = (c[ci("tld")] || ".it").replace(/^\.?/, ".");
    const listino = Number(c[ci("prezzo_listino")] || "0");
    const row = n + 1;

    if (!name || !pec || !legalName) {
      skip++;
      log.push(`${row};${legalName ?? ""};${name ?? ""};SKIP;riga incompleta`);
      continue;
    }
    const fqdn = `${name}${tld}`.toLowerCase();

    try {
      const norm = normalizeCompany({ legalName, pec, province: c[ci("provincia")] });
      const company = await db.company.upsert({
        where: { dedupeHash: norm.dedupeHash },
        update: { pec: norm.pec },
        create: {
          legalName: norm.legalName,
          normalizedName: norm.normalizedName,
          province: norm.province,
          provinceName: norm.provinceName,
          pec: norm.pec,
          vatNumber: norm.vatNumber,
          website: norm.website,
          sector: norm.sector,
          rawData: { source: "campaign-offerte" },
          dedupeHash: norm.dedupeHash,
        },
      });

      let domain = await db.domain.findUnique({ where: { fqdn } });
      if (!domain) {
        const segs = fqdn.split(".");
        const sld = segs[0] ?? fqdn;
        const extension = segs.slice(1).join(".") || "it";
        domain = await db.domain.create({
          data: {
            companyId: company.id,
            fqdn,
            sld,
            extension,
            status: "AVAILABLE",
            availabilityResult: "AVAILABLE",
            availabilityCheckedAt: new Date(),
            availabilityProvider: "campaign",
            sellingPrice: listino || 499,
          },
        });
      }

      const existingComm = await db.communication.findFirst({
        where: { companyId: company.id, offer: { domainId: domain.id } },
      });
      if (existingComm) {
        skip++;
        log.push(`${row};${legalName};${fqdn};SKIP;PEC già presente (${existingComm.status})`);
        continue;
      }

      if (["AVAILABLE", "PURCHASE_PENDING"].includes(domain.status)) {
        await markAsPurchased(
          domain.id,
          {
            purchasePrice: 0,
            currency: "EUR",
            registrar: "campaign",
            purchasedAt: new Date(),
            autoPublish: false,
          },
          actor,
        );
        domain = await db.domain.findUniqueOrThrow({ where: { id: domain.id } });
      }

      let offer = await db.offer.findFirst({ where: { domainId: domain.id, deletedAt: null } });
      if (!offer) {
        offer = await createOffer(domain.id, { sellingPrice: listino || 499 }, actor);
      }
      // porta il dominio a OFFER_PUBLISHED senza toccare lo storefront (le pagine esistono già)
      const d = await db.domain.findUniqueOrThrow({ where: { id: domain.id } });
      if (d.status === "OFFER_DRAFT") {
        await transition(domainStateConfig, domain.id, "OFFER_PUBLISHED", {
          actorType: "USER",
          requestId: actor.requestId,
          reason: "campagna: pagina già online su storefront",
        });
      }
      if (offer.status === "DRAFT") {
        await db.offer.update({
          where: { id: offer.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
      }

      const comm = await composePecDraft(offer.id, { templateName: "offerte" }, actor);
      await approvePec(comm.id, actor);
      await queuePecSend(comm.id, actor);

      ok++;
      log.push(`${row};${legalName};${fqdn};OK;accodata (${comm.id})`);
      console.log(`[${row}/${lines.length}] OK  ${legalName} -> ${fqdn}`);
    } catch (e) {
      err++;
      const msg = e instanceof Error ? e.message : String(e);
      log.push(`${row};${legalName};${fqdn};ERR;${msg.replace(/;/g, ",")}`);
      console.log(`[${row}/${lines.length}] ERR ${legalName} -> ${fqdn}: ${msg}`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "send-log.csv"), `\uFEFF${log.join("\r\n")}\r\n`);
  console.log(`\naccodate: ${ok} · saltate: ${skip} · errori: ${err}`);
  console.log(`-> ${join(OUT_DIR, "send-log.csv")}`);
  console.log(
    "L'invio SMTP lo fa il worker, a ritmo di pec.max_per_hour (ora 20/h). Alza il setting se vuoi più veloce.",
  );
  process.exit(0);
}

if (sendCsv) {
  await send(sendCsv);
} else {
  await dryRun();
}
