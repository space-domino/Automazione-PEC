import { createHash } from "node:crypto";
import { normalizeProvince } from "@/lib/geo/province";
import { cleanText, titleCaseIfUpper } from "@/lib/text";

/** Campi grezzi estratti da una riga CSV secondo il mapping. */
export interface RawCompanyFields {
  legalName?: string | null;
  vatNumber?: string | null;
  pec?: string | null;
  province?: string | null;
  website?: string | null;
  sector?: string | null;
}

export interface NormalizedCompany {
  /** Ragione sociale pulita (encoding/spazi), forma societaria MANTENUTA. */
  legalName: string;
  /** Nome commerciale: forma societaria e rumore rimossi. Per dedup e brand. */
  normalizedName: string;
  /** Forma societaria estratta (SRL, SPA, SNC, SAS, SCARL, COOP, SS, DI, ONLUS) o null. */
  companyForm: string | null;
  province: string | null;
  provinceName: string | null;
  pec: string | null;
  /** P.IVA a 11 cifre valida (checksum) oppure null. */
  vatNumber: string | null;
  /** Valore P.IVA come si presentava nel CSV (per rawData / diagnostica). */
  vatNumberRaw: string | null;
  website: string | null;
  sector: string | null;
  /** sha256(normalizedName | province | pec | vatNumber) — dedup quando manca la P.IVA. */
  dedupeHash: string;
}

// Forme societarie: pattern -> forma canonica. Ordine: frasi lunghe e sigle più
// specifiche PRIMA. (?<![a-z]) / (?![a-z]) evitano falsi positivi dentro le parole.
const COMPANY_FORMS: Array<[RegExp, string]> = [
  [/societ[àa]'?\s+a\s+responsabilit[àa]'?\s+limitata\s+semplificata/gi, "SRLS"],
  [/societ[àa]'?\s+a\s+responsabilit[àa]'?\s+limitata/gi, "SRL"],
  [/societ[àa]'?\s+in\s+accomandita\s+per\s+azioni/gi, "SAPA"],
  [/societ[àa]'?\s+per\s+azioni/gi, "SPA"],
  [/societ[àa]'?\s+in\s+nome\s+collettivo/gi, "SNC"],
  [/societ[àa]'?\s+in\s+accomandita\s+semplice/gi, "SAS"],
  [/societ[àa]'?\s+cooperativa(\s+a\s+responsabilit[àa]'?\s+limitata)?/gi, "COOP"],
  [/(?<![a-z])soc(iet[àa]'?)?\.?\s*coop(erativa)?\.?(\s*a\.?\s*r\.?\s*l\.?)?/gi, "COOP"],
  [/(?<![a-z])s\.?\s*r\.?\s*l\.?\s*s\.?(?![a-z])/gi, "SRLS"],
  [/(?<![a-z])s\.?\s*c\.?\s*a\.?\s*r\.?\s*l\.?(?![a-z])/gi, "SCARL"],
  [/(?<![a-z])s\.?\s*c\.?\s*r\.?\s*l\.?(?![a-z])/gi, "SCARL"],
  [/(?<![a-z])s\.?\s*a\.?\s*p\.?\s*a\.?(?![a-z])/gi, "SAPA"],
  [/(?<![a-z])s\.?\s*p\.?\s*a\.?(?![a-z])/gi, "SPA"],
  [/(?<![a-z])s\.?\s*r\.?\s*l\.?(?![a-z])/gi, "SRL"],
  [/(?<![a-z])s\.?\s*n\.?\s*c\.?(?![a-z])/gi, "SNC"],
  [/(?<![a-z])s\.?\s*a\.?\s*s\.?(?![a-z])/gi, "SAS"],
  [/(?<![a-z])o\.?\s*n\.?\s*l\.?\s*u\.?\s*s\.?(?![a-z])/gi, "ONLUS"],
  [/\bditta\s+individuale\b/gi, "DI"],
  [/\bimpresa\s+individuale\b/gi, "DI"],
  [/(?<![a-z])s\.?\s*s\.?(?![a-z])\s*$/gi, "SS"],
];

const TRIM_EDGES = /^[\s.,;:_\-–—&/\\]+|[\s.,;:_\-–—&/\\]+$/g;

function extractCompanyForm(name: string): { name: string; form: string | null } {
  let work = name;
  let form: string | null = null;
  for (const [re, canonical] of COMPANY_FORMS) {
    re.lastIndex = 0;
    if (re.test(work)) {
      form ??= canonical;
      work = work.replace(re, " ");
    }
  }
  work = work
    .replace(/\s*&\s*c\.?(?![a-z])/gi, " ") // "& C." (soci)
    .replace(/\s{2,}/g, " ")
    .replace(TRIM_EDGES, "")
    .trim();
  return { name: work, form };
}

/**
 * Validazione checksum della Partita IVA italiana (11 cifre).
 * Algoritmo di Luhn "all'italiana".
 */
export function isValidPartitaIva(value: string): boolean {
  const s = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let n = s.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function normalizeWebsite(value: string): string | null {
  let v = cleanText(value).toLowerCase();
  if (!v) return null;
  v = v
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return null;
  return `https://${v}`;
}

function normalizePec(value: string): string | null {
  const v = cleanText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function computeDedupeHash(parts: {
  normalizedName: string;
  province: string | null;
  pec: string | null;
  vatNumber: string | null;
}): string {
  const key = [
    parts.normalizedName.toLowerCase().trim(),
    parts.province ?? "",
    parts.pec ?? "",
    parts.vatNumber ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function normalizeCompany(input: RawCompanyFields): NormalizedCompany {
  const legalName = cleanText(input.legalName ?? "");

  const { name: withoutForm, form } = extractCompanyForm(legalName);
  const normalizedName = titleCaseIfUpper(withoutForm || legalName);

  const prov = normalizeProvince(input.province ?? undefined);

  const vatRaw = input.vatNumber ? cleanText(input.vatNumber) : null;
  const vatDigits = vatRaw ? vatRaw.replace(/\D/g, "") : "";
  const vatNumber = vatDigits && isValidPartitaIva(vatDigits) ? vatDigits : null;

  const pec = input.pec ? normalizePec(input.pec) : null;
  const website = input.website ? normalizeWebsite(input.website) : null;
  const sector = input.sector ? cleanText(input.sector) || null : null;

  const dedupeHash = computeDedupeHash({
    normalizedName,
    province: prov?.code ?? null,
    pec,
    vatNumber,
  });

  return {
    legalName,
    normalizedName,
    companyForm: form,
    province: prov?.code ?? null,
    provinceName: prov?.name ?? null,
    pec,
    vatNumber,
    vatNumberRaw: vatRaw,
    website,
    sector,
    dedupeHash,
  };
}
