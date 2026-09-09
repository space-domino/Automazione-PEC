import type { DiscoveryCandidate } from "@/prompts/domain-discovery-v1/schema";

/**
 * Post-processing DETERMINISTICO dei candidati AI (sezione H.4 / D — Fase 4):
 * lowercase, punycode, validazione FQDN, filtro estensioni ammesse,
 * espansione SLD, dedup per fqdn, clamp score/confidence, ordinamento e taglio.
 */
export interface ProcessedCandidate {
  fqdn: string;
  sld: string;
  extension: string;
  score: number;
  confidence: number;
  reason: string;
}

// label DNS: 1-63 char, alfanumerico, trattini interni
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function toAsciiHost(host: string): string | null {
  try {
    const h = new URL(`http://${host}`).hostname;
    return h || null;
  } catch {
    return null;
  }
}

function normSld(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function normExt(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/[^a-z0-9.-]/g, "");
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

function isValidFqdn(fqdn: string): boolean {
  if (fqdn.length > 253) return false;
  const labels = fqdn.split(".");
  return labels.length >= 2 && labels.every((l) => LABEL_RE.test(l));
}

export function postProcessCandidates(
  raw: DiscoveryCandidate[],
  allowedExtensions: string[],
  maxCandidates: number,
): ProcessedCandidate[] {
  const allowed = allowedExtensions.map(normExt).filter(Boolean);
  const allowedSet = new Set(allowed);
  const byFqdn = new Map<string, ProcessedCandidate>();

  for (const c of raw) {
    let sld = normSld(c.sld);

    // se l'AI ha messo l'estensione dentro l'sld ("alfa.it"), separala
    let inlineExt = "";
    const dot = sld.lastIndexOf(".");
    if (dot > 0) {
      inlineExt = sld.slice(dot + 1);
      sld = sld.slice(0, dot);
    }
    sld = sld.replace(/\.+/g, "-"); // altri punti residui -> trattino
    if (!sld) continue;

    const ext = normExt(c.extension) || inlineExt;

    let targets: string[];
    if (!ext)
      targets = allowed; // nessuna estensione -> espandi su tutte le ammesse
    else if (allowedSet.has(ext)) targets = [ext];
    else continue; // estensione non ammessa -> scarta

    const asciiSld = toAsciiHost(sld);
    if (!asciiSld || !asciiSld.split(".").every((l) => LABEL_RE.test(l))) continue;

    for (const t of targets) {
      const fqdn = `${asciiSld}.${t}`;
      if (!isValidFqdn(fqdn)) continue;

      const cand: ProcessedCandidate = {
        fqdn,
        sld: asciiSld,
        extension: t,
        score: clamp(c.score),
        confidence: clamp(c.confidence),
        reason: c.reason.trim().slice(0, 300),
      };
      const existing = byFqdn.get(fqdn);
      if (!existing || cand.score > existing.score) byFqdn.set(fqdn, cand);
    }
  }

  return [...byFqdn.values()]
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, Math.max(1, maxCandidates));
}
