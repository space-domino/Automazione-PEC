/** Tariffe AI e calcolo costo (sezioni B.2 / J). Prezzi in USD / 1M token. */

export interface TokenUsage {
  /** token di input a costo pieno (non da cache) */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

interface Rate {
  inPerMTok: number;
  outPerMTok: number;
}

export const MODEL_PRICING: Record<string, Rate> = {
  "claude-haiku-4-5": { inPerMTok: 1, outPerMTok: 5 },
  "claude-sonnet-5": { inPerMTok: 2, outPerMTok: 10 },
  "claude-opus-5": { inPerMTok: 5, outPerMTok: 25 },
  // OpenAI: da compilare quando si abilita quel provider.
};

/**
 * Costo in USD. Cache write ~1.25x input, cache read ~0.1x input (Anthropic).
 * Modello sconosciuto -> 0 (loggato altrove), non blocca.
 */
export function computeCostUsd(model: string, u: TokenUsage): number {
  const r = MODEL_PRICING[model];
  if (!r) return 0;
  const inTok = r.inPerMTok / 1_000_000;
  const outTok = r.outPerMTok / 1_000_000;
  return (
    u.inputTokens * inTok +
    u.cacheWriteTokens * inTok * 1.25 +
    u.cacheReadTokens * inTok * 0.1 +
    u.outputTokens * outTok
  );
}
