import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import {
  type DiscoveryInput,
  type DiscoveryOutput,
  DiscoveryOutputSchema,
} from "@/prompts/domain-discovery-v1/schema";
import {
  type EstimateInput,
  type EstimateOutput,
  EstimateOutputSchema,
} from "@/prompts/domain-estimate-v1/schema";
import {
  type ProposalInput,
  type ProposalOutput,
  ProposalOutputSchema,
} from "@/prompts/pec-proposal-v1/schema";
import * as z from "zod/v4";
import {
  AiBudgetExceededError,
  AiOutputInvalidError,
  AiProviderNotConfiguredError,
} from "./errors";
import { loadPrompt } from "./prompt-registry";
import { getProvider } from "./providers";
import type { AiProvider } from "./providers";
import { webResearch } from "./providers/anthropic";
import { checkDailyBudget, recordUsage } from "./usage";

export {
  AiBudgetExceededError,
  AiOutputInvalidError,
  AiProviderNotConfiguredError,
} from "./errors";
export type { DiscoveryInput, DiscoveryOutput } from "@/prompts/domain-discovery-v1/schema";
export type { ProposalInput, ProposalOutput } from "@/prompts/pec-proposal-v1/schema";
export type { EstimateInput, EstimateOutput } from "@/prompts/domain-estimate-v1/schema";
export { aiCostSummary, checkDailyBudget } from "./usage";
export type { AiCostSummary } from "./usage";

export interface GatewayCtx {
  companyId?: string;
  /** provider iniettabile (test). Default: getProvider() da AI_PROVIDER. */
  provider?: AiProvider;
}

const DISCOVERY_JSON_SCHEMA = z.toJSONSchema(DiscoveryOutputSchema) as Record<string, unknown>;
const PROPOSAL_JSON_SCHEMA = z.toJSONSchema(ProposalOutputSchema) as Record<string, unknown>;
const ESTIMATE_JSON_SCHEMA = z.toJSONSchema(EstimateOutputSchema) as Record<string, unknown>;

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

/**
 * Ricerca sul web (Anthropic-only, tool server-side): come nominano il dominio
 * attività simili nello stesso settore/zona. Testo libero, nessuno schema —
 * è il passo preparatorio di `estimateBestDomain` in services/domain-discovery.
 */
export async function researchDomainNaming(
  company: { legalName: string; sector: string | null; province: string | null },
  ctx: GatewayCtx = {},
): Promise<{ notes: string }> {
  if (env.AI_PROVIDER === "openai") {
    // Il tool di ricerca web è collegato solo al provider Anthropic qui.
    return { notes: "" };
  }
  const budget = await checkDailyBudget();
  if (!budget.withinBudget) {
    throw new AiBudgetExceededError(budget.spentUsd, budget.budgetUsd);
  }

  const models = await getSetting("ai.models");
  const model = models.DOMAIN_RANKING ?? "claude-sonnet-5";
  const system =
    "Cerchi sul web esempi di nomi a dominio usati da aziende italiane simili a quella indicata " +
    "(stesso settore e/o zona). Rispondi con una sintesi breve (max 5 righe) delle convenzioni " +
    "di naming osservate: pattern ricorrenti, lunghezza tipica, uso di trattini/località/suffissi. " +
    "Se non trovi nulla di utile o pertinente, dillo esplicitamente invece di inventare.";
  const user = JSON.stringify({
    legalName: company.legalName,
    sector: company.sector,
    province: company.province,
  });

  let res: Awaited<ReturnType<typeof webResearch>>;
  try {
    res = await webResearch(system, user, { model, maxTokens: 700, maxSearches: 5 });
  } catch (err) {
    // La ricerca web è un potenziamento, non un requisito: se fallisce (rete,
    // provider non disponibile) si prosegue senza, non si blocca la stima.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "ai-gateway: ricerca web fallita, proseguo senza",
    );
    return { notes: "" };
  }

  await recordUsage({
    callType: "DOMAIN_RANKING",
    provider: "anthropic",
    model: res.model,
    promptName: "domain-estimate-research",
    promptVersion: "v1",
    companyId: ctx.companyId,
    usage: res.usage,
    webSearchRequests: res.webSearchRequests,
    latencyMs: res.latencyMs,
    success: true,
  });

  return { notes: res.text.trim() };
}

/**
 * Sceglie UN SOLO dominio combinando i dati azienda con la sintesi di ricerca
 * web (sezione "Campagne" — stima del dominio migliore, opzione con ricerca).
 */
export async function rankBestDomain(
  input: EstimateInput,
  ctx: GatewayCtx = {},
): Promise<EstimateOutput> {
  if (env.AI_PROVIDER === "openai") {
    throw new AiProviderNotConfiguredError(
      "La stima con ricerca web richiede il provider Anthropic (AI_PROVIDER=openai attivo)",
    );
  }
  const budget = await checkDailyBudget();
  if (!budget.withinBudget) {
    throw new AiBudgetExceededError(budget.spentUsd, budget.budgetUsd);
  }

  const promptVersions = await getSetting("ai.prompt_versions");
  const version = promptVersions["domain-estimate"] ?? "v1";
  const prompt = loadPrompt("domain-estimate", version);

  const models = await getSetting("ai.models");
  const model = models.DOMAIN_RANKING ?? prompt.meta.defaultModel;

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
      jsonSchema: ESTIMATE_JSON_SCHEMA,
      model,
      maxTokens: prompt.meta.maxTokens,
    });

    let parsed: EstimateOutput | null = null;
    try {
      parsed = EstimateOutputSchema.parse(JSON.parse(res.raw));
      if (!input.allowedExtensions.includes(parsed.extension)) {
        lastError = `estensione "${parsed.extension}" non tra quelle ammesse`;
        parsed = null;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : "parse error";
      logger.warn({ attempt, err: lastError }, "ai-gateway: stima dominio non valida");
    }

    await recordUsage({
      callType: "DOMAIN_RANKING",
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
