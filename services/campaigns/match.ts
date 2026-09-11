import { env } from "@/lib/env";
import { slugify, stripAccents } from "@/lib/text";
import { normalizeCompany } from "@/services/company-registry/normalize";

/**
 * Abbinamento azienda -> dominio a catalogo su spacedomino (sezione "Campagne").
 * Logica portata da scripts/campaign-offerte.ts: normalizzazione + Dice a
 * bigrammi, un dominio per azienda (i migliori punteggi scelgono per primi).
 */

export const compact = (s: string): string =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export const eur = (n: number): string =>
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

export type Confidence = "alta" | "media" | "bassa" | "nessuno" | "manuale";

export function bucket(s: number): Exclude<Confidence, "manuale"> {
  if (s >= 0.92) return "alta";
  if (s >= 0.75) return "media";
  if (s >= 0.6) return "bassa";
  return "nessuno";
}

export interface ParsedCompany {
  legalName: string;
  province: string;
  pec: string;
  key: string;
}

export interface ParseResult {
  rows: ParsedCompany[];
  noPec: string[];
}

/**
 * Accetta testo incollato o file: righe TSV o CSV (`;` o `,`) con almeno
 * ragione sociale, provincia, PEC (in quest'ordine, altre colonne ignorate).
 * Salta l'intestazione e le righe senza PEC valida (le riporta in `noPec`).
 */
export function parseCompaniesText(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: ParsedCompany[] = [];
  const noPec: string[] = [];
  for (const line of lines) {
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const parts = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (parts.length < 3) continue;
    const legalName = parts[0] ?? "";
    const province = parts[1] ?? "";
    const pec = parts[2] ?? "";
    if (!legalName || /ragione sociale/i.test(legalName)) continue; // intestazione
    if (!pec || pec === "—" || !pec.includes("@")) {
      noPec.push(legalName);
      continue;
    }
    const norm = normalizeCompany({ legalName });
    rows.push({ legalName, province, pec, key: compact(norm.normalizedName || legalName) });
  }
  return { rows, noPec };
}

export interface CatalogProduct {
  id: number;
  name: string;
  tld: string;
  price: number;
  key: string;
}

/** Legge il catalogo di spacedomino (nome, tld, prezzo). Richiede SPACEDOMINO_DATABASE_URL. */
export async function loadCatalog(): Promise<CatalogProduct[]> {
  if (!env.SPACEDOMINO_DATABASE_URL) {
    throw new Error("SPACEDOMINO_DATABASE_URL non configurata: catalogo non raggiungibile");
  }
  const { createPool } = await import("mysql2/promise");
  const pool = createPool({ uri: env.SPACEDOMINO_DATABASE_URL, connectionLimit: 2 });
  try {
    const [rows] = await pool.query("SELECT id, name, tld, price FROM products");
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      tld: String(r.tld).replace(/^\.?/, "."),
      price: Number(r.price),
      key: compact(String(r.name)),
    }));
  } finally {
    await pool.end();
  }
}

export interface Match {
  company: ParsedCompany;
  product: CatalogProduct | null;
  score: number;
  conf: Exclude<Confidence, "manuale">;
}

/** Un dominio per azienda: i punteggi migliori scelgono per primi. */
export function matchAll(companies: ParsedCompany[], catalog: CatalogProduct[]): Match[] {
  const used = new Set<number>();
  const out: Match[] = [];
  const order = companies
    .map((c) => {
      let bestScore = 0;
      for (const p of catalog) bestScore = Math.max(bestScore, score(c.key, p.key));
      return { c, bestScore };
    })
    .sort((a, b) => b.bestScore - a.bestScore);

  for (const { c } of order) {
    let best: CatalogProduct | null = null;
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
  const idx = new Map(companies.map((c, i) => [c, i]));
  out.sort((a, b) => (idx.get(a.company) ?? 0) - (idx.get(b.company) ?? 0));
  return out;
}

export function landingUrlForFqdn(fqdn: string): string {
  return `${env.SPACEDOMINO_BASE_URL.replace(/\/+$/, "")}/domini/${slugify(fqdn)}`;
}
