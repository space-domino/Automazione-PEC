import { computeCostUsd } from "@/lib/ai/pricing";
import { describe, expect, it } from "vitest";

const z = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("computeCostUsd", () => {
  it("Haiku 4.5: $1 / 1M input", () => {
    expect(computeCostUsd("claude-haiku-4-5", { ...z, inputTokens: 1_000_000 })).toBeCloseTo(1, 6);
  });

  it("Haiku 4.5: cache read a 0.1x, cache write a 1.25x", () => {
    expect(computeCostUsd("claude-haiku-4-5", { ...z, cacheReadTokens: 1_000_000 })).toBeCloseTo(
      0.1,
      6,
    );
    expect(computeCostUsd("claude-haiku-4-5", { ...z, cacheWriteTokens: 1_000_000 })).toBeCloseTo(
      1.25,
      6,
    );
  });

  it("Sonnet 5: $10 / 1M output", () => {
    expect(computeCostUsd("claude-sonnet-5", { ...z, outputTokens: 1_000_000 })).toBeCloseTo(10, 6);
  });

  it("modello sconosciuto -> 0", () => {
    expect(computeCostUsd("gpt-boh", { ...z, inputTokens: 999, outputTokens: 999 })).toBe(0);
  });

  it("caso realistico discovery (~ordine di grandezza atteso)", () => {
    const c = computeCostUsd("claude-haiku-4-5", {
      inputTokens: 180,
      cacheReadTokens: 700,
      cacheWriteTokens: 0,
      outputTokens: 220,
    });
    expect(c).toBeGreaterThan(0.0005);
    expect(c).toBeLessThan(0.005);
  });
});
