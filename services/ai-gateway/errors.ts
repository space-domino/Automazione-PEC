export class AiOutputInvalidError extends Error {
  constructor(detail: string) {
    super(`Output AI non conforme allo schema dopo il retry: ${detail}`);
    this.name = "AiOutputInvalidError";
  }
}

export class AiBudgetExceededError extends Error {
  constructor(
    public spentUsd: number,
    public budgetUsd: number,
  ) {
    super(`Budget AI giornaliero superato: $${spentUsd.toFixed(2)} / $${budgetUsd.toFixed(2)}`);
    this.name = "AiBudgetExceededError";
  }
}

export class AiProviderNotConfiguredError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "AiProviderNotConfiguredError";
  }
}
