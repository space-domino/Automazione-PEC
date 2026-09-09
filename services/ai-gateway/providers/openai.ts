import { AiProviderNotConfiguredError } from "../errors";
import type { AiProvider } from "./types";

/**
 * Segnaposto. L'architettura è provider-agnostica (interfaccia AiProvider):
 * per abilitare OpenAI, implementare `complete()` con l'SDK ufficiale `openai`
 * (Responses API + structured outputs) verificando la documentazione corrente,
 * e aggiungere le tariffe in lib/ai/pricing.ts.
 * Fino ad allora usare AI_PROVIDER=anthropic.
 */
export const openaiProvider: AiProvider = {
  name: "openai",
  async complete() {
    throw new AiProviderNotConfiguredError(
      "Provider OpenAI non implementato. Imposta AI_PROVIDER=anthropic oppure implementa services/ai-gateway/providers/openai.ts.",
    );
  },
};
