import { type TokenUsage, computeCostUsd } from "@/lib/ai/pricing";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { AiCallType } from "@prisma/client";

export interface RecordUsageArgs {
  callType: AiCallType;
  provider: string;
  model: string;
  promptName: string;
  promptVersion: string;
  companyId?: string | null;
  domainId?: string | null;
  usage: TokenUsage;
  latencyMs: number;
  success: boolean;
  error?: string | null;
}

/** Scrive una riga AiUsage e ritorna il costo in USD calcolato. */
export async function recordUsage(a: RecordUsageArgs): Promise<number> {
  const costUsd = computeCostUsd(a.model, a.usage);
  await db.aiUsage.create({
    data: {
      callType: a.callType,
      provider: a.provider,
      model: a.model,
      promptName: a.promptName,
      promptVersion: a.promptVersion,
      companyId: a.companyId ?? null,
      domainId: a.domainId ?? null,
      inputTokens: a.usage.inputTokens + a.usage.cacheWriteTokens,
      cachedInputTokens: a.usage.cacheReadTokens,
      outputTokens: a.usage.outputTokens,
      costUsd,
      latencyMs: a.latencyMs,
      success: a.success,
      error: a.error ?? null,
    },
  });
  return costUsd;
}

export interface BudgetStatus {
  withinBudget: boolean;
  spentUsd: number;
  budgetUsd: number;
}

/** Somma del costo AI nelle ultime 24h vs `ai.daily_budget_usd` (sezione H.10). */
export async function checkDailyBudget(): Promise<BudgetStatus> {
  const budgetUsd = await getSetting("ai.daily_budget_usd");
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const agg = await db.aiUsage.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: since } },
  });
  const spentUsd = Number(agg._sum.costUsd ?? 0);
  return { withinBudget: spentUsd < budgetUsd, spentUsd, budgetUsd };
}

export interface AiCostSummary {
  totalCostUsd: number;
  last24hCostUsd: number;
  totalCalls: number;
  failedCalls: number;
  budgetUsd: number;
  byCallType: Array<{ callType: string; costUsd: number; calls: number }>;
}

/** Riepilogo costi AI per dashboard e GET /api/ai-usage (sezione 28). */
export async function aiCostSummary(): Promise<AiCostSummary> {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const [all, last24h, failed, grouped, budgetUsd] = await Promise.all([
    db.aiUsage.aggregate({ _sum: { costUsd: true }, _count: { _all: true } }),
    db.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: since24h } } }),
    db.aiUsage.count({ where: { success: false } }),
    db.aiUsage.groupBy({ by: ["callType"], _sum: { costUsd: true }, _count: { _all: true } }),
    getSetting("ai.daily_budget_usd"),
  ]);
  return {
    totalCostUsd: Number(all._sum.costUsd ?? 0),
    last24hCostUsd: Number(last24h._sum.costUsd ?? 0),
    totalCalls: all._count._all,
    failedCalls: failed,
    budgetUsd,
    byCallType: grouped.map((g) => ({
      callType: g.callType,
      costUsd: Number(g._sum.costUsd ?? 0),
      calls: g._count._all,
    })),
  };
}
