import { env } from "@/lib/env";
import Anthropic from "@anthropic-ai/sdk";
import { AiProviderNotConfiguredError } from "../errors";
import type { AiCompleteRequest, AiCompleteResult, AiProvider } from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AiProviderNotConfiguredError("ANTHROPIC_API_KEY non impostata in .env");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const anthropicProvider: AiProvider = {
  name: "anthropic",

  async complete(req: AiCompleteRequest): Promise<AiCompleteResult> {
    const startedAt = Date.now();

    const res = await getClient().messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
      // Structured outputs: vincola la risposta al JSON Schema. Il parsing lo fa il gateway.
      output_config: { format: { type: "json_schema", schema: req.jsonSchema } },
    });

    const raw = res.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");

    return {
      raw,
      model: res.model,
      latencyMs: Date.now() - startedAt,
      usage: {
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};
