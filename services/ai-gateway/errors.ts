import { ApiError } from "@/lib/api/errors";

export class AiOutputInvalidError extends ApiError {
  constructor(detail: string) {
    super(502, "AI_OUTPUT_INVALID", `Output AI non conforme allo schema dopo il retry: ${detail}`);
    this.name = "AiOutputInvalidError";
  }
}

export class AiBudgetExceededError extends ApiError {
  constructor(
    public spentUsd: number,
    public budgetUsd: number,
  ) {
    super(
      429,
      "AI_BUDGET_EXCEEDED",
      `Budget AI giornaliero superato: $${spentUsd.toFixed(2)} / $${budgetUsd.toFixed(2)}`,
    );
    this.name = "AiBudgetExceededError";
  }
}

export class AiProviderNotConfiguredError extends ApiError {
  constructor(detail: string) {
    super(503, "AI_NOT_CONFIGURED", detail);
    this.name = "AiProviderNotConfiguredError";
  }
}
