import type { TokenUsage } from "@/lib/ai/pricing";

export interface AiCompleteRequest {
  /** system prompt stabile (cacheato dal provider dove supportato) */
  system: string;
  /** messaggio utente (tipicamente JSON dell'input) */
  user: string;
  /** JSON Schema atteso per l'output */
  jsonSchema: Record<string, unknown>;
  model: string;
  maxTokens: number;
}

export interface AiCompleteResult {
  /** testo grezzo restituito (JSON atteso, non ancora validato) */
  raw: string;
  usage: TokenUsage;
  latencyMs: number;
  model: string;
}

/** Interfaccia unica dei provider AI (sezione H.2). Sostituibile via AI_PROVIDER. */
export interface AiProvider {
  readonly name: string;
  complete(req: AiCompleteRequest): Promise<AiCompleteResult>;
}
