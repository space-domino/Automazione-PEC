import { env } from "@/lib/env";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import type { AiProvider } from "./types";

export function getProvider(): AiProvider {
  return env.AI_PROVIDER === "openai" ? openaiProvider : anthropicProvider;
}

export type { AiProvider, AiCompleteRequest, AiCompleteResult } from "./types";
