/** Utility di testo condivise. Nessuna dipendenza. */

// Marchi non-spaziatori (accenti dopo la decomposizione NFD).
const DIACRITICS = /\p{Mn}/gu;
const APOSTROPHES = /[‘’‚‛`´]/g;
const QUOTES = /[“”„‟]/g;
const NBSP = / /g;

/** Rimuove i diacritici: "società" -> "societa". */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS, "");
}

/**
 * Pulizia base di un valore testuale dal CSV:
 * NFC, apostrofi/virgolette tipografiche -> ASCII, NBSP -> spazio, whitespace collassato, trim.
 * NON tocca gli accenti (à/è/ì/ò/ù restano).
 */
export function cleanText(input: string): string {
  return input
    .normalize("NFC")
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(NBSP, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const LOWER_WORDS = new Set([
  "di",
  "de",
  "del",
  "della",
  "dello",
  "dei",
  "degli",
  "delle",
  "da",
  "dal",
  "e",
  "ed",
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
  "in",
  "su",
  "per",
  "con",
  "a",
  "al",
  "allo",
  "alla",
]);

/**
 * Title Case "gentile" applicato SOLO se la stringa è tutta maiuscola
 * (tipico dei registri): "ALFA COSTRUZIONI" -> "Alfa Costruzioni".
 * Se contiene già minuscole la lascia com'è (rispetta "IT Solutions", "eXtra").
 */
export function titleCaseIfUpper(s: string): string {
  const letters = s.replace(/[^A-Za-zÀ-ɏ]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return s;

  return s
    .toLowerCase()
    .split(/(\s+|[-'])/)
    .map((tok, idx) => {
      if (/^\s+$/.test(tok) || tok === "-" || tok === "'") return tok;
      if (idx > 0 && LOWER_WORDS.has(tok)) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join("");
}

/** slug URL-safe: "Alfa Costruzioni S.r.l." -> "alfa-costruzioni-s-r-l". */
export function slugify(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Normalizza un'intestazione di colonna per il confronto con gli alias. */
export function normalizeHeader(h: string): string {
  return stripAccents(cleanText(h))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
