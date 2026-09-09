import { normalizeHeader } from "@/lib/text";

export const COMPANY_FIELDS = [
  "legalName",
  "vatNumber",
  "pec",
  "province",
  "website",
  "sector",
] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

export const FIELD_LABELS: Record<CompanyField, string> = {
  legalName: "Ragione sociale",
  vatNumber: "Partita IVA",
  pec: "PEC",
  province: "Provincia",
  website: "Sito web",
  sector: "Settore",
};

export const REQUIRED_FIELDS: CompanyField[] = ["legalName"];

/** Alias (verranno normalizzati con normalizeHeader per il confronto). */
const ALIASES: Record<CompanyField, string[]> = {
  legalName: [
    "ragione sociale",
    "ragionesociale",
    "rag soc",
    "rag sociale",
    "denominazione",
    "denominazione impresa",
    "denominazione azienda",
    "nome azienda",
    "nome impresa",
    "azienda",
    "impresa",
    "ditta",
    "nome",
    "company",
    "company name",
    "business name",
  ],
  vatNumber: [
    "partita iva",
    "p iva",
    "piva",
    "partitaiva",
    "p i v a",
    "codice partita iva",
    "iva",
    "vat",
    "vat number",
    "vat id",
  ],
  pec: [
    "pec",
    "posta elettronica certificata",
    "posta certificata",
    "indirizzo pec",
    "email pec",
    "pec impresa",
    "domicilio digitale",
  ],
  province: [
    "provincia",
    "prov",
    "pr",
    "sigla provincia",
    "sigla prov",
    "provincia sede",
    "provincia sede legale",
  ],
  website: [
    "sito web",
    "sito",
    "website",
    "web",
    "url",
    "sito internet",
    "homepage",
    "sito aziendale",
    "indirizzo web",
  ],
  sector: [
    "settore",
    "ateco",
    "codice ateco",
    "attivita",
    "descrizione attivita",
    "attivita prevalente",
    "settore merceologico",
    "categoria",
  ],
};

const NORM_ALIASES: Record<CompanyField, Set<string>> = Object.fromEntries(
  COMPANY_FIELDS.map((f) => [f, new Set(ALIASES[f].map(normalizeHeader))]),
) as Record<CompanyField, Set<string>>;

export type Mapping = Partial<Record<CompanyField, number>>;

/**
 * Propone un mapping campo -> indice colonna a partire dalle intestazioni.
 * 1) match esatto sull'alias normalizzato
 * 2) match parziale (l'intestazione contiene l'alias o viceversa)
 * Nessuna colonna viene assegnata a due campi.
 */
export function suggestMapping(headers: string[]): Mapping {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const result: Mapping = {};

  for (const field of COMPANY_FIELDS) {
    const idx = norm.findIndex(
      (h, i) => !used.has(i) && h.length > 0 && NORM_ALIASES[field].has(h),
    );
    if (idx >= 0) {
      result[field] = idx;
      used.add(idx);
    }
  }

  for (const field of COMPANY_FIELDS) {
    if (result[field] != null) continue;
    const idx = norm.findIndex(
      (h, i) =>
        !used.has(i) &&
        h.length > 2 &&
        [...NORM_ALIASES[field]].some((a) => a.length > 2 && (h.includes(a) || a.includes(h))),
    );
    if (idx >= 0) {
      result[field] = idx;
      used.add(idx);
    }
  }

  return result;
}
