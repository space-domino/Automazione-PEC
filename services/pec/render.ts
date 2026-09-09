/**
 * Rendering minimale dei MessageTemplate (sezione H.6).
 * Sintassi: `{{chiave}}` (HTML-escaped) e `{{{chiave}}}` (raw).
 * Chiavi piatte, come nei template del seed (company_name, domain, price, ...).
 * Nessuna dipendenza, nessuna logica: solo sostituzione.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c] ?? c);
}

const RAW = /\{\{\{\s*([\w.]+)\s*\}\}\}/g;
const ESC = /\{\{\s*([\w.]+)\s*\}\}/g;

function lookup(vars: TemplateVars, key: string): string {
  const v = vars[key];
  return v == null ? "" : String(v);
}

/** Applica le variabili al template. I placeholder non risolti diventano "". */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(RAW, (_, k: string) => lookup(vars, k))
    .replace(ESC, (_, k: string) => escapeHtml(lookup(vars, k)));
}

/** Elenca i placeholder presenti nel template (per validazione/anteprima). */
export function templatePlaceholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\{?\s*([\w.]+)\s*\}?\}\}/g)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/** Deriva un corpo testuale grezzo dall'HTML quando il template non ne fornisce uno. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
