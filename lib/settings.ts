import { db } from "./db";

/**
 * Lettura tipizzata delle impostazioni (sezione 29 / F.8).
 * I default qui sono l'ULTIMA rete di sicurezza: la fonte reale è la tabella
 * Setting popolata dal seed. Cache in memoria di 30s per non martellare il DB.
 */
const DEFAULTS = {
  "domain.extensions": ["it", "com"] as string[],
  "discovery.max_candidates": 5,
  "discovery.use_company_analysis": false,
  "discovery.result_ttl_days": 30,
  "ai.confidence_threshold": 55,
  "ai.models": {
    DOMAIN_DISCOVERY: "claude-haiku-4-5",
    DOMAIN_RANKING: "claude-sonnet-5",
    COMPANY_ANALYSIS: "claude-haiku-4-5",
    PEC_GENERATION: "claude-sonnet-5",
    TEXT_IMPROVEMENT: "claude-sonnet-5",
  } as Record<string, string>,
  "ai.prompt_versions": {
    "domain-discovery": "v1",
    "domain-ranking": "v1",
    "company-analysis": "v1",
    "pec-generation": "v1",
    "pec-proposal": "v1",
  } as Record<string, string>,
  "ai.daily_budget_usd": 20,
  "ranking.weights": {
    aiConfidence: 0.3,
    nameMatch: 0.25,
    availability: 0.2,
    brevity: 0.15,
    extension: 0.1,
  } as Record<string, number>,
  "ranking.tie_delta": 5,
  "availability.cache_ttl_hours": 24,
  "availability.recheck_days": 14,
  "price.default": 499,
  /** quando un dominio passa a PURCHASED: crea+pubblica l'offerta in automatico (M7/M13). */
  "offers.auto_publish": true as boolean,
  /** dopo la pubblicazione dell'offerta: prepara in automatico la bozza PEC (personalizzata). */
  "pec.auto_compose": true as boolean,
  /** dopo la compose automatica: approva e invia senza intervento umano. Default OFF. */
  "pec.auto_send": false as boolean,
  "pec.max_per_hour": 20,
  /** MessageTemplate PEC_BODY attivo (id). "" => usa il primo PEC_BODY isActive. */
  "pec.active_template": "" as string,
  /** cursore UID dell'ultima mail IMAP processata dal poller ricevute */
  "pec.imap.last_uid": 0 as number,
  /** finestra (giorni) entro cui il poller cerca ricevute alla prima esecuzione */
  "pec.receipts.lookback_days": 14,
} as const;

export type SettingKey = keyof typeof DEFAULTS;

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 30_000;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as (typeof DEFAULTS)[K];

  const row = await db.setting.findUnique({ where: { key } });
  const value = (row?.value ?? DEFAULTS[key]) as (typeof DEFAULTS)[K];
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Scrive/aggiorna una impostazione e invalida la cache locale della chiave. */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: (typeof DEFAULTS)[K],
): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
  cache.delete(key);
}

export function clearSettingsCache(): void {
  cache.clear();
}
