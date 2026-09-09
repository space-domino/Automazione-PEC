import { logger } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import {
  type DiscoveryInput,
  type DiscoveryOutput,
  DiscoveryOutputSchema,
} from "@/prompts/domain-discovery-v1/schema";
import {
  type ProposalInput,
  type ProposalOutput,
  ProposalOutputSchema,
} from "@/prompts/pec-proposal-v1/schema";
import * as z from "zod/v4";
import { AiBudgetExceededError, AiOutputInvalidError } from "./errors";
import { loadPrompt } from "./prompt-registry";
import { getProvider } from "./providers";
import type { AiProvider } from "./providers";
import { checkDailyBudget, recordUsage } from "./usage";

export {
  AiBudgetExceededError,
  AiOutputInvalidError,
  AiProviderNotConfiguredError,
} from "./errors";
export type { DiscoveryInput, DiscoveryOutput } from "@/prompts/domain-discovery-v1/schema";
export type { ProposalInput, ProposalOutput } from "@/prompts/pec-proposal-v1/schema";
export { aiCostSummary, checkDailyBudget } from "./usage";
export type { AiCostSummary } from "./usage";

export interface GatewayCtx {
  companyId?: string;
  /** provider iniettabile (test). Default: getProvider() da AI_PROVIDER. */
  provider?: AiProvider;
}

const DISCOVERY_JSON_SCHEMA = z.toJSONSchema(DiscoveryOutputSchema) as Record<string, unknown>;
const PROPOSAL_JSON_SCHEMA = z.toJSONSchema(ProposalOutputSchema) as Record<string, unknown>;

/**
 * Genera i candidati dominio per un'azienda (sezione H.4).
 * - budget guard prima della chiamata
 * - structured outputs + validazione Zod, 1 retry, poi errore pulito
 * - ogni tentativo registra AiUsage (successo o fallimento)
 */
export async function generateDomainCandidates(
  input: DiscoveryInput,
  ctx: GatewayCtx = {},
): Promise<DiscoveryOutput> {
  const budget = await checkDailyBudget();
  if (!budget.withinBudget) {
    throw new AiBudgetExceededError(budget.spentUsd, budget.budgetUsd);
  }

  const promptVersions = await getSetting("ai.prompt_versions");
  const version = promptVersions["domain-discovery"] ?? "v1";
  const prompt = loadPrompt("domain-discovery", version);

  const models = await getSetting("ai.models");
  const model = models.DOMAIN_DISCOVERY ?? prompt.meta.defaultModel;

  const provider = ctx.provider ?? getProvider();
  const userJson = JSON.stringify(input);

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await provider.complete({
      system: prompt.system,
      user:
        attempt === 1
          ? userJson
          : `${userJson}\n\nATTENZIONE: l'output precedente non era JSON valido conforme allo schema (${lastError}). Rispondi SOLO con JSON valido.`,
      jsonSchema: DISCOVERY_JSON_SCHEMA,
      model,
      maxTokens: prompt.meta.maxTokens,
    });

    let parsed: DiscoveryOutput | null = null;
    try {
      parsed = DiscoveryOutputSchema.parse(JSON.parse(res.raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : "parse error";
      logger.warn({ attempt, err: lastError }, "ai-gateway: output non valido");
    }

    await recordUsage({
      callType: "DOMAIN_DISCOVERY",
      provider: provider.name,
      model: res.model,
      promptName: prompt.name,
      promptVersion: prompt.version,
      companyId: ctx.companyId,
      usage: res.usage,
      latencyMs: res.latencyMs,
      success: parsed !== null,
      error: parsed ? null : lastError,
    });

    if (parsed) return parsed;
  }

  throw new AiOutputInvalidError(lastError);
}

/**
 * Rifinisce il testo commerciale di una PEC (sezione 2 — unico uso AI ammesso
 * per il copy). Stesso schema operativo di generateDomainCandidates.
 */
export async function improveProposalCopy(
  input: ProposalInput,
  ctx: GatewayCtx = {},
): Promise<ProposalOutput> {
  const budget = await checkDailyBudget();
  if (!budget.withinBudget) {
    throw new AiBudgetExceededError(budget.spentUsd, budget.budgetUsd);
  }

  const promptVersions = await getSetting("ai.prompt_versions");
  const version = promptVersions["pec-proposal"] ?? "v1";
  const prompt = loadPrompt("pec-proposal", version);

  const models = await getSetting("ai.models");
  const model = models.TEXT_IMPROVEMENT ?? prompt.meta.defaultModel;

  const provider = ctx.provider ?? getProvider();
  const userJson = JSON.stringify(input);

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await provider.complete({
      system: prompt.system,
      user:
        attempt === 1
          ? userJson
          : `${userJson}\n\nATTENZIONE: l'output precedente non era JSON valido conforme allo schema (${lastError}). Rispondi SOLO con JSON valido.`,
      jsonSchema: PROPOSAL_JSON_SCHEMA,
      model,
      maxTokens: prompt.meta.maxTokens,
    });

    let parsed: ProposalOutput | null = null;
    try {
      parsed = ProposalOutputSchema.parse(JSON.parse(res.raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : "parse error";
      logger.warn({ attempt, err: lastError }, "ai-gateway: proposta non valida");
    }

    await recordUsage({
      callType: "TEXT_IMPROVEMENT",
      provider: provider.name,
      model: res.model,
      promptName: prompt.name,
      promptVersion: prompt.version,
      companyId: ctx.companyId,
      usage: res.usage,
      latencyMs: res.latencyMs,
      success: parsed !== null,
      error: parsed ? null : lastError,
    });

    if (parsed) return parsed;
  }

  throw new AiOutputInvalidError(lastError);
}
